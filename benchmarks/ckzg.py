"""
ckzg stub — EIP-4844 KZG cryptography library.

ckzg has no prebuilt Windows wheel for CPython 3.12 and cannot be compiled
from source without additional build tooling. This stub satisfies the hard
top-level import that web3 6.x performs in _utils/type_conversion.py.

All functions raise NotImplementedError if actually called. Blob transactions
(EIP-4844) are not used in this benchmark harness.
"""

# Constants expected by web3 6.x
BYTES_PER_FIELD_ELEMENT = 32
FIELD_ELEMENTS_PER_BLOB = 4096
BYTES_PER_BLOB = BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB


def _blob_unavailable(*args, **kwargs):
    raise NotImplementedError(
        "ckzg C extension not available on Windows Python 3.12. "
        "Blob transactions (EIP-4844) are not supported in this harness."
    )


blob_to_kzg_commitment = _blob_unavailable
compute_kzg_proof = _blob_unavailable
compute_blob_kzg_proof = _blob_unavailable
verify_kzg_proof = _blob_unavailable
verify_blob_kzg_proof = _blob_unavailable
verify_blob_kzg_proof_batch = _blob_unavailable
load_trusted_setup = _blob_unavailable
load_trusted_setup_file = _blob_unavailable
