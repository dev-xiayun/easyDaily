"""项目映射读写：别名 -> 标准项目名。"""

from __future__ import annotations

import json
import re
from pathlib import Path

DEFAULT_MAPPING_FILE = Path(__file__).with_name("project_mapping.json")
ALIAS_SPLIT_PATTERN = re.compile(r"[;；]")


def split_aliases(text: str) -> list[str]:
    if not text or not str(text).strip():
        return []
    parts = ALIAS_SPLIT_PATTERN.split(str(text))
    aliases: list[str] = []
    seen: set[str] = set()
    for part in parts:
        alias = part.strip()
        if not alias:
            continue
        key = alias.lower()
        if key in seen:
            continue
        seen.add(key)
        aliases.append(alias)
    return aliases


def join_aliases(aliases: list[str]) -> str:
    cleaned: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        text = str(alias).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    return "；".join(cleaned)


def load_flat_mapping(mapping_file: Path | None = None) -> dict[str, str]:
    path = mapping_file or DEFAULT_MAPPING_FILE
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"项目映射文件格式错误: {path}")
    return {str(k).strip(): str(v).strip() for k, v in data.items()}


def grouped_projects_from_flat(flat_mapping: dict[str, str]) -> list[dict]:
    groups: dict[str, list[str]] = {}
    for alias, project_name in flat_mapping.items():
        groups.setdefault(project_name, [])
        if alias.lower() != project_name.lower():
            groups[project_name].append(alias)

    projects = []
    for project_name in sorted(groups.keys()):
        aliases = groups[project_name]
        aliases.sort(key=lambda item: item.lower())
        projects.append({"name": project_name, "aliases": aliases})
    return projects


def flat_mapping_from_grouped(projects: list[dict]) -> dict[str, str]:
    flat: dict[str, str] = {}
    alias_owner: dict[str, str] = {}

    for item in projects:
        name = str(item.get("name", "")).strip()
        if not name:
            raise ValueError("项目名称不能为空")

        aliases = item.get("aliases", [])
        if isinstance(aliases, str):
            aliases = split_aliases(aliases)
        elif not isinstance(aliases, list):
            aliases = []

        all_aliases = split_aliases(join_aliases([name, *aliases]))
        if not all_aliases:
            all_aliases = [name]

        for alias in all_aliases:
            key = alias.lower()
            if key in alias_owner and alias_owner[key] != name:
                raise ValueError(f"别名「{alias}」已被项目「{alias_owner[key]}」使用")
            alias_owner[key] = name
            flat[alias] = name

    return flat


def load_grouped_projects(mapping_file: Path | None = None) -> list[dict]:
    flat = load_flat_mapping(mapping_file)
    return grouped_projects_from_flat(flat)


def save_grouped_projects(projects: list[dict], mapping_file: Path | None = None) -> dict[str, str]:
    path = mapping_file or DEFAULT_MAPPING_FILE
    flat = flat_mapping_from_grouped(projects)
    with path.open("w", encoding="utf-8") as f:
        json.dump(flat, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return flat
