"""
solana/idl_convert.py -- Convert Anchor 0.32 IDL to anchorpy-core 0.2 format.

Migrated from benchmarks/convert_idl.py. Preserves ALL existing logic.

Usage:
    python -m clients.python sol:idl_convert --src path/to/crowdfunding.json --dst path/to/out.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys


# --- type conversion ---

def convert_type(t):
    """
    Recursively convert Anchor 0.32 type repr to anchorpy-core 0.2 format.
    Only rename needed: 'pubkey' -> 'publicKey'.
    """
    if isinstance(t, str):
        return 'publicKey' if t == 'pubkey' else t
    if isinstance(t, dict):
        if 'array' in t:
            elem, size = t['array']
            return {'array': [convert_type(elem), size]}
        if 'vec' in t:
            return {'vec': convert_type(t['vec'])}
        if 'option' in t:
            return {'option': convert_type(t['option'])}
        # 'defined', 'generic', etc. pass through unchanged
    return t


# --- PDA conversion ---

def convert_seed(seed):
    """
    Convert a single Anchor 0.32 PDA seed to the old anchorpy format.

    New format (no type field):
        {'kind': 'const',   'value': [...]}
        {'kind': 'account', 'path': 'xxx'}
        {'kind': 'arg',     'path': 'xxx'}

    Old format (requires type field):
        {'kind': 'const',   'type': 'bytes',     'value': [...]}
        {'kind': 'account', 'type': 'publicKey',  'path': 'xxx'}
        {'kind': 'arg',     'type': 'u64',        'path': 'xxx'}
    """
    kind = seed.get('kind')
    if kind == 'const':
        return {'kind': 'const', 'type': 'bytes', 'value': seed['value']}
    elif kind == 'account':
        return {'kind': 'account', 'type': 'publicKey', 'path': seed['path']}
    elif kind == 'arg':
        # We do not have the arg IDL type here; u64 covers all our cases
        return {'kind': 'arg', 'type': 'u64', 'path': seed['path']}
    else:
        return seed  # unknown kind -- pass through


def convert_pda(pda):
    """
    Convert Anchor 0.32 PDA block.

    New: optional 'program' key  ->  Old: optional 'programId' key
    """
    if pda is None:
        return None
    result = {'seeds': [convert_seed(s) for s in pda.get('seeds', [])]}
    if 'program' in pda:
        prog = pda['program']
        # prog = {'kind': 'const', 'value': [...32 bytes...]}
        result['programId'] = {
            'kind': 'const',
            'type': 'publicKey',
            'value': prog['value'],
        }
    return result


# --- instruction account conversion ---

def convert_instruction_account(acc):
    """
    Convert a single instruction account entry.

    Anchor 0.32 -> anchorpy-core 0.2:
      writable -> isMut
      signer   -> isSigner
      pda      -> pda (with converted seeds)
      address  -> DROPPED
      relations -> DROPPED
    """
    result = {
        'name': acc['name'],
        'isMut': bool(acc.get('writable', False)),
        'isSigner': bool(acc.get('signer', False)),
    }
    if acc.get('isOptional') or acc.get('optional'):
        result['isOptional'] = True
    if 'docs' in acc:
        result['docs'] = acc['docs']
    if 'pda' in acc:
        result['pda'] = convert_pda(acc['pda'])
    # 'address' and 'relations' are intentionally dropped
    return result


# --- instruction conversion ---

def convert_instruction(ix):
    result = {
        'name': ix['name'],
        'accounts': [convert_instruction_account(a) for a in ix.get('accounts', [])],
        'args': [
            {'name': a['name'], 'type': convert_type(a['type'])}
            for a in ix.get('args', [])
        ],
    }
    # discriminator is silently ignored by anchorpy but harmless to keep
    if 'discriminator' in ix:
        result['discriminator'] = ix['discriminator']
    if 'docs' in ix:
        result['docs'] = ix['docs']
    if 'returns' in ix:
        result['returns'] = convert_type(ix['returns'])
    return result


# --- type definition conversion ---

def convert_field(f):
    result = {'name': f['name'], 'type': convert_type(f['type'])}
    if 'docs' in f:
        result['docs'] = f['docs']
    return result


def convert_type_definition(td):
    ty = td['type']
    kind = ty['kind']
    if kind == 'struct':
        result_ty = {
            'kind': 'struct',
            'fields': [convert_field(f) for f in ty.get('fields', [])],
        }
    elif kind == 'enum':
        result_ty = {
            'kind': 'enum',
            'variants': ty.get('variants', []),
        }
    else:
        result_ty = ty  # pass through unknown kinds
    result = {'name': td['name'], 'type': result_ty}
    if 'docs' in td:
        result['docs'] = td['docs']
    return result


# --- main ---

def convert(src_path, dst_path):
    with open(src_path) as f:
        src = json.load(f)

    # Anchor 0.32 stores name/version inside 'metadata'; old format wants them at root
    meta = src.get('metadata', {})
    name = meta.get('name', src.get('name', 'crowdfunding'))
    version = meta.get('version', src.get('version', '0.1.0'))

    # Build a lookup: type name -> full typedef (for merging into 'accounts')
    types_map = {t['name']: t for t in src.get('types', [])}

    out = {
        'version': version,
        'name': name,
        'instructions': [convert_instruction(ix) for ix in src.get('instructions', [])],
        'accounts': [],
        'types': [],
        'errors': src.get('errors', []),
    }

    # In Anchor 0.32, 'accounts' only holds {name, discriminator}.
    # The actual struct definition lives in 'types'.
    # Old anchorpy expects 'accounts' to be full TypeDefinitions (kind+fields).
    processed_as_account = set()
    for acc in src.get('accounts', []):
        acc_name = acc['name']
        if acc_name in types_map:
            out['accounts'].append(convert_type_definition(types_map[acc_name]))
            processed_as_account.add(acc_name)
        else:
            # Fallback: emit empty struct (should not happen for our IDL)
            out['accounts'].append({
                'name': acc_name,
                'type': {'kind': 'struct', 'fields': []},
            })

    # Remaining types (not account structs) go into 'types'
    for td in src.get('types', []):
        if td['name'] not in processed_as_account:
            out['types'].append(convert_type_definition(td))

    # Keep metadata for documentation purposes
    if meta:
        out['metadata'] = meta

    with open(dst_path, 'w') as f:
        json.dump(out, f, indent=2)

    return out


def main(args=None) -> None:
    from clients.python.solana.config import REPO_ROOT
    idl_dir = REPO_ROOT / 'contracts' / 'solana' / 'target' / 'idl'

    parser = argparse.ArgumentParser(description='Convert Anchor 0.32 IDL to anchorpy-core 0.2 format')
    parser.add_argument('--src', default=str(idl_dir / 'crowdfunding.json'))
    parser.add_argument('--dst', default=str(idl_dir / 'crowdfunding.python.json'))
    parsed = parser.parse_args(args)

    out = convert(parsed.src, parsed.dst)
    print(f'Written: {parsed.dst}')
    print(f'  instructions : {[ix["name"] for ix in out["instructions"]]}')
    print(f'  accounts     : {[a["name"] for a in out["accounts"]]}')
    print(f'  types        : {[t["name"] for t in out["types"]]}')


if __name__ == '__main__':
    main()
