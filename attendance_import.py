"""考勤 Excel 解析。"""

from __future__ import annotations

import re
from io import BytesIO
from typing import Any

import pandas as pd

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _normalize_date(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text:
        return None
    if len(text) >= 10 and DATE_PATTERN.match(text[:10]):
        return text[:10]
    match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        return match.group(1)
    return None


def parse_attendance_excel(file_bytes: bytes) -> list[dict[str, str]]:
    df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=None)
    if df.empty or df.shape[0] < 3:
        raise ValueError("考勤 Excel 内容为空或格式不正确")

    header_row = 1 if df.shape[0] > 1 else 0
    section_titles = {
        col: str(df.iloc[0, col]).strip() if pd.notna(df.iloc[0, col]) else ""
        for col in range(df.shape[1])
    }

    date_column_map: dict[str, tuple[int, str]] = {}
    for col in range(df.shape[1]):
        date_text = _normalize_date(df.iloc[header_row, col])
        if not date_text:
            continue

        section_title = section_titles.get(col, "")
        for prev_col in range(col - 1, -1, -1):
            title = section_titles.get(prev_col, "")
            if title:
                section_title = title
                break

        priority = 0
        if section_title == "每日考勤结果":
            priority = 2
        elif section_title == "打卡时间":
            priority = 1

        current = date_column_map.get(date_text)
        if current is None or priority >= current[0]:
            date_column_map[date_text] = (priority, col)

    date_columns = sorted(
        ((column, date_text) for date_text, (_, column) in date_column_map.items()),
        key=lambda item: item[1],
    )

    if not date_columns:
        raise ValueError("未在 Excel 中识别到日期列，请使用标准月度汇总模板")

    records: list[dict[str, str]] = []
    for row_idx in range(header_row + 1, df.shape[0]):
        raw_name = df.iloc[row_idx, 0]
        if raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name)):
            continue
        name = str(raw_name).strip()
        if not name or name in {"姓名", "工号"}:
            continue

        for col, attendance_date in date_columns:
            raw_value = df.iloc[row_idx, col]
            if raw_value is None or (isinstance(raw_value, float) and pd.isna(raw_value)):
                continue
            attendance_text = str(raw_value).strip()
            if not attendance_text:
                continue
            records.append(
                {
                    "name": name,
                    "date": attendance_date,
                    "text": attendance_text,
                }
            )

    if not records:
        raise ValueError("Excel 中未解析到有效考勤数据")

    return records
