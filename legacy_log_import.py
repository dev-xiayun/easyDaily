"""原系统日志 Excel 导入。"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from typing import Any

import pandas as pd

from database import import_legacy_system_work_logs

REQUIRED_COLUMNS = ("项目名称", "姓名", "日志日期", "工时", "日志内容")


def _normalize_header(value: Any) -> str:
    return str(value or "").strip()


def _parse_log_date(value: Any) -> date:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        raise ValueError("日志日期不能为空")
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if hasattr(value, "date"):
        return value.date()
    text = str(value).strip()
    if not text:
        raise ValueError("日志日期不能为空")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:19], fmt).date()
        except ValueError:
            continue
    raise ValueError(f"无法解析日志日期：{text}")


def parse_legacy_system_log_excel(file_bytes: bytes) -> dict[str, Any]:
    try:
        df = pd.read_excel(io.BytesIO(file_bytes))
    except Exception as exc:
        raise ValueError("无法读取 Excel 文件，请确认格式为 .xlsx") from exc

    if df.empty:
        raise ValueError("Excel 文件中没有数据")

    columns = [_normalize_header(col) for col in df.columns]
    column_map = {col: idx for idx, col in enumerate(columns)}
    missing = [col for col in REQUIRED_COLUMNS if col not in column_map]
    if missing:
        raise ValueError(f"缺少必要列：{'、'.join(missing)}")

    records: list[dict[str, Any]] = []
    project_names: set[str] = set()

    for row_index, row in df.iterrows():
        project_name = _normalize_header(row.iloc[column_map["项目名称"]])
        display_name = _normalize_header(row.iloc[column_map["姓名"]])
        work_content = _normalize_header(row.iloc[column_map["日志内容"]])
        hours_raw = row.iloc[column_map["工时"]]
        date_raw = row.iloc[column_map["日志日期"]]

        if not project_name and not display_name and pd.isna(hours_raw):
            continue
        if not project_name:
            raise ValueError(f"第 {row_index + 2} 行缺少项目名称")
        if not display_name:
            raise ValueError(f"第 {row_index + 2} 行缺少姓名")
        if pd.isna(hours_raw):
            raise ValueError(f"第 {row_index + 2} 行缺少工时")

        try:
            hours = float(hours_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"第 {row_index + 2} 行工时格式无效") from exc
        if hours <= 0:
            raise ValueError(f"第 {row_index + 2} 行工时必须大于 0")

        log_day = _parse_log_date(date_raw)
        project_names.add(project_name)
        records.append(
            {
                "项目名称": project_name,
                "姓名": display_name,
                "日期": log_day,
                "工时（小时）": hours,
                "工作内容": work_content,
            }
        )

    if not records:
        raise ValueError("Excel 中未识别到有效日志记录")

    if len(project_names) != 1:
        names = "、".join(sorted(project_names))
        raise ValueError(f"文档中必须只包含同一个项目，当前识别到：{names}")

    return {
        "project_name": next(iter(project_names)),
        "records": records,
        "parsed_count": len(records),
    }


def import_legacy_system_logs_from_excel(file_bytes: bytes) -> dict[str, Any]:
    parsed = parse_legacy_system_log_excel(file_bytes)
    result = import_legacy_system_work_logs(parsed["project_name"], parsed["records"])
    result["project_name"] = parsed["project_name"]
    result["parsed_count"] = parsed["parsed_count"]
    return result
