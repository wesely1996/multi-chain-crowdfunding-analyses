"""
deploy_evm.py -- Thin shim; logic moved to clients/python/evm/deploy.py.

Standalone usage is preserved:
    python benchmarks/deploy_evm.py --variant V1 --env hardhat-localnet
"""

import sys
import pathlib

# Allow imports from repo root so `clients.python` resolves
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from clients.python.evm.deploy import deploy, main  # noqa: E402

if __name__ == "__main__":
    main()
