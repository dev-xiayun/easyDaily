"""转换历史记录文件存储。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
HISTORY_DIR = BASE_DIR / "data" / "history"
INDEX_FILE = HISTORY_DIR / "index.json"


def _ensure_dir() -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _load_index() -> list[dict[str, Any]]:
    _ensure_dir()
    if not INDEX_FILE.exists():
        return []
    with INDEX_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    return data


def _save_index(items: list[dict[str, Any]]) -> None:
    _ensure_dir()
    with INDEX_FILE.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _record_path(record_id: str) -> Path:
    return HISTORY_DIR / f"{record_id}.json"


def list_history() -> list[dict[str, Any]]:
    items = _load_index()
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return items


def get_history(record_id: str) -> dict[str, Any] | None:
    path = _record_path(record_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_history(
    *,
    source_filename: str,
    year: int,
    month: int,
    output_filename: str,
    sheet_name: str,
    token: str,
    summary: dict[str, Any],
    rows: list[dict[str, Any]],
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    _ensure_dir()
    record_id = uuid.uuid4().hex
    created_at = _now_text()

    serialized_records = []
    for record in records:
        item = dict(record)
        date_value = item.get("日期")
        if isinstance(date_value, datetime):
            item["日期"] = date_value.strftime("%Y-%m-%d")
        serialized_records.append(item)

    payload = {
        "id": record_id,
        "created_at": created_at,
        "source_filename": source_filename,
        "year": year,
        "month": month,
        "output_filename": output_filename,
        "sheet_name": sheet_name,
        "token": token,
        "summary": summary,
        "rows": rows,
        "records": serialized_records,
    }

    with _record_path(record_id).open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    index_item = {
        "id": record_id,
        "created_at": created_at,
        "source_filename": source_filename,
        "year": year,
        "month": month,
        "output_filename": output_filename,
        "total_records": summary.get("total_records", 0),
        "total_hours": summary.get("total_hours", 0),
    }
    index = _load_index()
    index.append(index_item)
    _save_index(index)
    return index_item


def delete_history(record_id: str) -> bool:
    index = _load_index()
    new_index = [item for item in index if item.get("id") != record_id]
    if len(new_index) == len(index):
        return False

    _save_index(new_index)
    path = _record_path(record_id)
    if path.exists():
        path.unlink()
    return True
