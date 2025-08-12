import hashlib
import tempfile
from pathlib import Path

import pytest
from core.utils.utils import calculate_file_hash


@pytest.mark.unit
def test_calculate_file_hash():
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(b"test content")
        tmp.flush()
        tmp_path = Path(tmp.name)
    expected_hash = hashlib.sha256(b"test content").hexdigest()
    actual_hash = calculate_file_hash(tmp_path)
    assert actual_hash == expected_hash
