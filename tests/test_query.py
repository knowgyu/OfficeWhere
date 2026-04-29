from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.api.query import join_query, order_join_files
from backend.models.schemas import JoinRequest


def test_order_join_files_places_base_file_first():
    ordered = order_join_files(
        [
            SimpleNamespace(file_id=2, columns=["b"]),
            SimpleNamespace(file_id=1, columns=["a"]),
            SimpleNamespace(file_id=3, columns=["c"]),
        ],
        base_file_id=3,
    )

    assert [item.file_id for item in ordered] == [3, 2, 1]


def test_join_query_is_disabled_for_search_version_focus():
    with pytest.raises(HTTPException) as exc_info:
        join_query(JoinRequest(files=[{"file_id": 1, "columns": []}]))

    assert exc_info.value.status_code == 410
    assert "비활성화" in exc_info.value.detail
