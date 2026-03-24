"""
__main__.py -- CLI router for the Python client.

Usage:
    python -m clients.python <operation> [args]
    python -m clients.python evm:<operation> [args]
    python -m clients.python sol:<operation> [args]

Operations:
    deploy, create_campaign, contribute, finalize, withdraw, refund, status

Prefix "sol:" routes to clients.python.solana.*, prefix "evm:" (or bare)
routes to clients.python.evm.*.

Examples:
    python -m clients.python evm:deploy --variant V1
    python -m clients.python evm:contribute --amount 10
    python -m clients.python sol:contribute --amount 10
    python -m clients.python status                          # defaults to evm
"""

from __future__ import annotations

import sys


# Map of operation name -> (evm_module_path, solana_module_path)
OPERATIONS = {
    "deploy":          ("clients.python.evm.deploy",          None),
    "create_campaign": ("clients.python.evm.create_campaign", "clients.python.solana.create_campaign"),
    "contribute":      ("clients.python.evm.contribute",      "clients.python.solana.contribute"),
    "finalize":        ("clients.python.evm.finalize",        "clients.python.solana.finalize"),
    "withdraw":        ("clients.python.evm.withdraw",        "clients.python.solana.withdraw"),
    "refund":          ("clients.python.evm.refund",          "clients.python.solana.refund"),
    "status":          ("clients.python.evm.status",          "clients.python.solana.status"),
    "idl_convert":     (None,                                  "clients.python.solana.idl_convert"),
    "create_mint":     (None,                                  "clients.python.solana.create_mint"),
}


def _print_help() -> None:
    print("Python client for multi-chain crowdfunding benchmarks.")
    print()
    print("Usage:")
    print("    python -m clients.python <operation> [args]")
    print("    python -m clients.python evm:<operation> [args]")
    print("    python -m clients.python sol:<operation> [args]")
    print()
    print("Operations:")
    for op, (evm_mod, sol_mod) in OPERATIONS.items():
        chains = []
        if evm_mod:
            chains.append("evm")
        if sol_mod:
            chains.append("sol")
        print(f"    {op:<20s}  [{', '.join(chains)}]")
    print()
    print("Use --help after any operation for operation-specific arguments.")
    print()
    print("Examples:")
    print("    python -m clients.python evm:deploy --variant V1")
    print("    python -m clients.python evm:contribute --amount 10")
    print("    python -m clients.python sol:contribute --amount 10")
    print("    python -m clients.python evm:status")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        _print_help()
        sys.exit(0)

    raw_op = sys.argv[1]
    remaining_args = sys.argv[2:]

    # Parse chain prefix
    if ":" in raw_op:
        prefix, op_name = raw_op.split(":", 1)
        prefix = prefix.lower()
    else:
        prefix = "evm"  # default to EVM
        op_name = raw_op

    # Normalize operation name (allow hyphens)
    op_name = op_name.replace("-", "_")

    if op_name not in OPERATIONS:
        print(f"Error: Unknown operation '{op_name}'.", file=sys.stderr)
        print(f"Available: {', '.join(OPERATIONS.keys())}", file=sys.stderr)
        sys.exit(1)

    evm_mod, sol_mod = OPERATIONS[op_name]

    if prefix == "sol":
        if sol_mod is None:
            print(f"Error: Operation '{op_name}' is not available for Solana.", file=sys.stderr)
            sys.exit(1)
        module_path = sol_mod
    elif prefix == "evm":
        if evm_mod is None:
            print(f"Error: Operation '{op_name}' is not available for EVM.", file=sys.stderr)
            sys.exit(1)
        module_path = evm_mod
    else:
        print(f"Error: Unknown chain prefix '{prefix}'. Use 'evm' or 'sol'.", file=sys.stderr)
        sys.exit(1)

    # Import and call main(args)
    import importlib
    module = importlib.import_module(module_path)

    # Replace sys.argv so argparse in the target module sees the right args
    sys.argv = [module_path] + remaining_args
    module.main(remaining_args)


if __name__ == "__main__":
    main()
