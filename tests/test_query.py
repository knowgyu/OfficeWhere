from types import SimpleNamespace

from backend.api.query import order_join_files


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
