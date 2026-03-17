"""
convert_idl.py -- Thin shim; logic moved to clients/python/solana/idl_convert.py.

Standalone usage is preserved:
    python benchmarks/convert_idl.py --src path/to/idl.json --dst path/to/out.json
"""

import sys
import pathlib

# Allow imports from repo root so `clients.python` resolves
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from clients.python.solana.idl_convert import convert, main  # noqa: E402

if __name__ == "__main__":
    main()
