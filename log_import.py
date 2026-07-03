"""历史日志 Excel 导入。"""

from __future__ import annotations

import io
from typing import Any

from convert_logs import UNKNOWN_PROJECT, collect_logs_for_year
from database import get_flat_project_mapping, import_historical_work_logs
from project_store import load_flat_mapping


def load_import_project_mapping() -> dict[str, str]:
    mapping = load_flat_mapping()
    db_mapping = get_flat_project_mapping()
    merged = dict(mapping)
    merged.update(db_mapping)
    return merged


def parse_log_import_excel(file_bytes: bytes, year: int) -> list[dict[str, Any]]:
    mapping = load_import_project_mapping()
    records = collect_logs_for_year(io.BytesIO(file_bytes), year, mapping)
    if not records:
        raise ValueError(f"{year} 年未在 Excel 中识别到任何日志记录")

    unknown_count = sum(1 for record in records if record["项目"] == UNKNOWN_PROJECT)
    if unknown_count == len(records):
        raise ValueError("所有日志项目均未匹配到系统项目，请检查项目映射后重试")

    return records


def import_logs_from_excel(file_bytes: bytes, year: int) -> dict[str, Any]:
    records = parse_log_import_excel(file_bytes, year)
    result = import_historical_work_logs(records)
    result["year"] = year
    result["parsed_count"] = len(records)
    return result
