"""SQLite 数据库初始化与数据访问。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterator

from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "dailay_converter.db"
MAPPING_FILE = BASE_DIR / "project_mapping.json"

USER_STATUS_PENDING = "pending"
USER_STATUS_APPROVED = "approved"
USER_STATUS_REJECTED = "rejected"
PROJECT_STATUS_ENABLED = "enabled"
PROJECT_STATUS_DISABLED = "disabled"
ROLE_ADMIN = "admin"
ROLE_USER = "user"
LOG_REVIEW_PENDING = "pending"
LOG_REVIEW_APPROVED = "approved"
LOG_REVIEW_REJECTED = "rejected"
LOG_ADD_START_HOUR = 17
LOG_OPEN_DURATION_HOURS = 12
WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def round_hours(value: float) -> float:
    return round(float(value), 2)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'enabled',
                manager_user_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS project_aliases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                alias TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(alias),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS work_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                log_date TEXT NOT NULL,
                hours REAL NOT NULL,
                work_content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_work_logs_user_date ON work_logs(user_id, log_date);
            CREATE INDEX IF NOT EXISTS idx_work_logs_project ON work_logs(project_id);
            """
        )

        admin = conn.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
        if admin is None:
            ts = now_text()
            conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, role, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "admin",
                    generate_password_hash("admin", method="pbkdf2:sha256"),
                    "系统管理员",
                    ROLE_ADMIN,
                    USER_STATUS_APPROVED,
                    ts,
                    ts,
                ),
            )

        project_count = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
        if project_count == 0 and MAPPING_FILE.exists():
            _import_projects_from_mapping(conn)

        _migrate_work_logs(conn)
        _migrate_attendance_records(conn)
        _migrate_log_open_periods(conn)
        _migrate_user_log_open_periods(conn)


def _migrate_log_open_periods(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS log_open_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date TEXT NOT NULL UNIQUE,
            opened_by INTEGER NOT NULL,
            opened_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_log_open_periods_expires ON log_open_periods(expires_at)"
    )


def _migrate_user_log_open_periods(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_log_open_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            log_date TEXT NOT NULL,
            opened_by INTEGER NOT NULL,
            opened_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            UNIQUE(user_id, log_date),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_log_open_periods_expires ON user_log_open_periods(expires_at)"
    )


def _migrate_attendance_records(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            attendance_date TEXT NOT NULL,
            attendance_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, attendance_date),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, attendance_date)"
    )


def _migrate_work_logs(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(work_logs)").fetchall()}
    if "review_status" not in cols:
        conn.execute("ALTER TABLE work_logs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'")
        conn.execute("ALTER TABLE work_logs ADD COLUMN reject_reason TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE work_logs ADD COLUMN reviewed_by INTEGER")
        conn.execute("ALTER TABLE work_logs ADD COLUMN reviewed_at TEXT")


def _import_projects_from_mapping(conn: sqlite3.Connection) -> None:
    with MAPPING_FILE.open("r", encoding="utf-8") as f:
        flat = json.load(f)
    if not isinstance(flat, dict):
        return

    groups: dict[str, list[str]] = {}
    for alias, name in flat.items():
        alias = str(alias).strip()
        name = str(name).strip()
        if not name:
            continue
        groups.setdefault(name, [])
        if alias.lower() != name.lower():
            groups[name].append(alias)

    ts = now_text()
    for name, aliases in groups.items():
        cur = conn.execute(
            """
            INSERT INTO projects (name, status, manager_user_id, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            """,
            (name, PROJECT_STATUS_ENABLED, ts, ts),
        )
        project_id = cur.lastrowid
        for alias in aliases:
            conn.execute(
                """
                INSERT OR IGNORE INTO project_aliases (project_id, alias, created_at)
                VALUES (?, ?, ?)
                """,
                (project_id, alias, ts),
            )


def row_to_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return None
    user = row_to_user(row)
    if user["role"] != ROLE_ADMIN and user["status"] != USER_STATUS_APPROVED:
        return None
    return user


def register_user(username: str, password: str, display_name: str) -> dict[str, Any]:
    username = username.strip()
    display_name = display_name.strip() or username
    if not username or not password:
        raise ValueError("用户名和密码不能为空")
    if len(password) < 4:
        raise ValueError("密码长度至少 4 位")

    ts = now_text()
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if exists:
            raise ValueError("用户名已存在")
        cur = conn.execute(
            """
            INSERT INTO users (username, password_hash, display_name, role, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                username,
                generate_password_hash(password, method="pbkdf2:sha256"),
                display_name,
                ROLE_USER,
                USER_STATUS_PENDING,
                ts,
                ts,
            ),
        )
        user_id = cur.lastrowid
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_user(row)  # type: ignore[return-value]


def list_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, username, display_name, role, status, created_at, updated_at
            FROM users ORDER BY created_at DESC
            """
        ).fetchall()
    return [row_to_user(row) for row in rows]  # type: ignore[misc]


def query_admin_users(
    keyword: str = "",
    role: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    keyword = keyword.strip()
    role = role.strip()
    status = status.strip()
    page = max(1, int(page))
    page_size = max(1, min(50, int(page_size)))

    conditions: list[str] = []
    params: list[Any] = []
    if role in {ROLE_ADMIN, ROLE_USER}:
        conditions.append("role = ?")
        params.append(role)
    if status in {USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED}:
        conditions.append("status = ?")
        params.append(status)
    if keyword:
        conditions.append("(username LIKE ? OR display_name LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])

    where_clause = f" WHERE {' AND '.join(conditions)}" if conditions else ""

    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM users{where_clause}", params).fetchone()[0]
        total_pages = max(1, (int(total) + page_size - 1) // page_size) if total else 1
        current_page = min(page, total_pages) if total else 1
        offset = (current_page - 1) * page_size
        rows = conn.execute(
            f"""
            SELECT id, username, display_name, role, status, created_at, updated_at
            FROM users{where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

    return {
        "items": [row_to_user(row) for row in rows],  # type: ignore[misc]
        "pagination": {
            "page": current_page,
            "page_size": page_size,
            "total": int(total),
            "total_pages": total_pages,
        },
    }


def summarize_admin_users() -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS user_count,
                COALESCE(SUM(CASE WHEN role = ? THEN 1 ELSE 0 END), 0) AS admin_count,
                COALESCE(SUM(CASE WHEN role = ? THEN 1 ELSE 0 END), 0) AS normal_user_count,
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS pending_count,
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS approved_count,
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS rejected_count
            FROM users
            """,
            (
                ROLE_ADMIN,
                ROLE_USER,
                USER_STATUS_PENDING,
                USER_STATUS_APPROVED,
                USER_STATUS_REJECTED,
            ),
        ).fetchone()
        manager_row = conn.execute(
            """
            SELECT COUNT(DISTINCT manager_user_id) AS manager_count
            FROM projects
            WHERE manager_user_id IS NOT NULL
            """
        ).fetchone()

    return {
        "user_count": int(row["user_count"]),
        "admin_count": int(row["admin_count"]),
        "normal_user_count": int(row["normal_user_count"]),
        "pending_count": int(row["pending_count"]),
        "approved_count": int(row["approved_count"]),
        "rejected_count": int(row["rejected_count"]),
        "manager_count": int(manager_row["manager_count"]),
    }


def validate_password(password: str) -> None:
    if len(password) <= 6:
        raise ValueError("密码长度需超过 6 位")


def update_user_profile(user_id: int, display_name: str, password: str | None = None) -> dict[str, Any]:
    display_name = display_name.strip()
    if not display_name:
        raise ValueError("姓名不能为空")

    ts = now_text()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise ValueError("用户不存在")

        if password:
            validate_password(password)
            conn.execute(
                """
                UPDATE users
                SET display_name = ?, password_hash = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    display_name,
                    generate_password_hash(password, method="pbkdf2:sha256"),
                    ts,
                    user_id,
                ),
            )
        else:
            conn.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (display_name, ts, user_id),
            )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_user(updated)  # type: ignore[return-value]


def admin_set_user_password(user_id: int, password: str, confirm_password: str) -> dict[str, Any]:
    if password != confirm_password:
        raise ValueError("两次输入的密码不一致")
    validate_password(password)

    ts = now_text()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise ValueError("用户不存在")
        conn.execute(
            """
            UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
            """,
            (generate_password_hash(password, method="pbkdf2:sha256"), ts, user_id),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_user(updated)  # type: ignore[return-value]


def update_user_status(user_id: int, status: str) -> dict[str, Any] | None:
    if status not in {USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED}:
        raise ValueError("无效的用户状态")
    ts = now_text()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            return None
        if row["role"] == ROLE_ADMIN:
            raise ValueError("不能修改管理员账户状态")
        conn.execute(
            "UPDATE users SET status = ?, updated_at = ? WHERE id = ?",
            (status, ts, user_id),
        )
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_user(updated)


def list_approved_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, username, display_name, role, status, created_at, updated_at
            FROM users
            WHERE status = ? OR role = ?
            ORDER BY display_name
            """,
            (USER_STATUS_APPROVED, ROLE_ADMIN),
        ).fetchall()
    return [row_to_user(row) for row in rows]  # type: ignore[misc]


def get_flat_project_mapping() -> dict[str, str]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.status, a.alias
            FROM projects p
            LEFT JOIN project_aliases a ON a.project_id = p.id
            """
        ).fetchall()

    mapping: dict[str, str] = {}
    for row in rows:
        mapping[row["name"]] = row["name"]
        if row["alias"]:
            mapping[row["alias"]] = row["name"]
    return mapping


def list_projects(include_disabled: bool = True, keyword: str = "", status: str = "") -> list[dict[str, Any]]:
    keyword = keyword.strip()
    status = status.strip()
    query = """
        SELECT p.id, p.name, p.status, p.manager_user_id, p.created_at, p.updated_at,
               u.display_name AS manager_name
        FROM projects p
        LEFT JOIN users u ON u.id = p.manager_user_id
    """
    params: list[Any] = []
    conditions = []
    if status in {PROJECT_STATUS_ENABLED, PROJECT_STATUS_DISABLED}:
        conditions.append("p.status = ?")
        params.append(status)
    elif not include_disabled:
        conditions.append("p.status = ?")
        params.append(PROJECT_STATUS_ENABLED)
    if keyword:
        conditions.append("(p.name LIKE ? OR EXISTS (SELECT 1 FROM project_aliases a WHERE a.project_id = p.id AND a.alias LIKE ?))")
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY p.name"

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
        result = []
        for row in rows:
            aliases = conn.execute(
                "SELECT alias FROM project_aliases WHERE project_id = ? ORDER BY alias",
                (row["id"],),
            ).fetchall()
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "status": row["status"],
                    "manager_user_id": row["manager_user_id"],
                    "manager_name": row["manager_name"],
                    "aliases": [item["alias"] for item in aliases],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )
    return result


def summarize_admin_projects(keyword: str = "", status: str = "") -> dict[str, Any]:
    projects = list_projects(include_disabled=True, keyword=keyword, status=status)
    project_ids = [project["id"] for project in projects]

    enabled_count = sum(1 for project in projects if project["status"] == PROJECT_STATUS_ENABLED)
    disabled_count = len(projects) - enabled_count
    manager_set_count = sum(1 for project in projects if project.get("manager_user_id"))
    alias_count = sum(len(project.get("aliases") or []) for project in projects)

    summary = {
        "project_count": len(projects),
        "enabled_count": enabled_count,
        "disabled_count": disabled_count,
        "manager_set_count": manager_set_count,
        "manager_unset_count": len(projects) - manager_set_count,
        "alias_count": alias_count,
        "log_count": 0,
        "log_hours": 0.0,
        "log_approved_count": 0,
        "log_pending_count": 0,
        "log_rejected_count": 0,
        "log_approved_hours": 0.0,
    }

    if not project_ids:
        return summary

    placeholders = ",".join("?" * len(project_ids))
    with get_conn() as conn:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS log_count,
                COALESCE(SUM(hours), 0) AS log_hours,
                COALESCE(SUM(CASE WHEN review_status = ? THEN 1 ELSE 0 END), 0) AS log_approved_count,
                COALESCE(SUM(CASE WHEN review_status = ? THEN 1 ELSE 0 END), 0) AS log_pending_count,
                COALESCE(SUM(CASE WHEN review_status = ? THEN 1 ELSE 0 END), 0) AS log_rejected_count,
                COALESCE(SUM(CASE WHEN review_status = ? THEN hours ELSE 0 END), 0) AS log_approved_hours
            FROM work_logs
            WHERE project_id IN ({placeholders})
            """,
            [
                LOG_REVIEW_APPROVED,
                LOG_REVIEW_PENDING,
                LOG_REVIEW_REJECTED,
                LOG_REVIEW_APPROVED,
                *project_ids,
            ],
        ).fetchone()

    summary["log_count"] = int(row["log_count"])
    summary["log_hours"] = round_hours(float(row["log_hours"]))
    summary["log_approved_count"] = int(row["log_approved_count"])
    summary["log_pending_count"] = int(row["log_pending_count"])
    summary["log_rejected_count"] = int(row["log_rejected_count"])
    summary["log_approved_hours"] = round_hours(float(row["log_approved_hours"]))
    return summary


def save_projects(projects: list[dict[str, Any]]) -> None:
    ts = now_text()
    with get_conn() as conn:
        for item in projects:
            name = str(item.get("name", "")).strip()
            if not name:
                raise ValueError("项目名称不能为空")
            status = item.get("status", PROJECT_STATUS_ENABLED)
            if status not in {PROJECT_STATUS_ENABLED, PROJECT_STATUS_DISABLED}:
                raise ValueError(f"无效的项目状态: {status}")
            manager_user_id = item.get("manager_user_id")
            if manager_user_id in ("", None):
                manager_user_id = None
            else:
                manager_user_id = int(manager_user_id)
            aliases = item.get("aliases") or []
            if isinstance(aliases, str):
                aliases = [part.strip() for part in aliases.replace("；", ";").split(";") if part.strip()]

            project_id = item.get("id")
            if project_id:
                conn.execute(
                    """
                    UPDATE projects
                    SET name = ?, status = ?, manager_user_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (name, status, manager_user_id, ts, project_id),
                )
                conn.execute("DELETE FROM project_aliases WHERE project_id = ?", (project_id,))
            else:
                cur = conn.execute(
                    """
                    INSERT INTO projects (name, status, manager_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (name, status, manager_user_id, ts, ts),
                )
                project_id = cur.lastrowid

            for alias in aliases:
                alias = str(alias).strip()
                if not alias or alias.lower() == name.lower():
                    continue
                conn.execute(
                    """
                    INSERT INTO project_aliases (project_id, alias, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (project_id, alias, ts),
                )


def create_project(
    name: str,
    aliases: list[str] | None = None,
    manager_user_id: int | None = None,
    status: str = PROJECT_STATUS_ENABLED,
) -> dict[str, Any]:
    if status not in {PROJECT_STATUS_ENABLED, PROJECT_STATUS_DISABLED}:
        raise ValueError(f"无效的项目状态: {status}")
    save_projects(
        [
            {
                "name": name,
                "status": status,
                "manager_user_id": manager_user_id,
                "aliases": aliases or [],
            }
        ]
    )
    projects = list_projects(include_disabled=True, keyword=name)
    for project in projects:
        if project["name"] == name.strip():
            return project
    raise ValueError("创建项目失败")


def get_project(project_id: int, enabled_only: bool = False) -> dict[str, Any] | None:
    projects = list_projects(include_disabled=not enabled_only)
    for project in projects:
        if project["id"] == project_id:
            if enabled_only and project["status"] != PROJECT_STATUS_ENABLED:
                return None
            return project
    return None


def user_is_project_manager(user_id: int) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM projects WHERE manager_user_id = ? LIMIT 1",
            (user_id,),
        ).fetchone()
    return row is not None


def enrich_user(user: dict[str, Any]) -> dict[str, Any]:
    data = dict(user)
    data["is_project_manager"] = user_is_project_manager(data["id"])
    return data


def get_review_deadline(log_date: date) -> datetime:
    return datetime.combine(log_date + timedelta(days=1), time(12, 0, 0))


def is_log_date_admin_opened(log_date: date, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT expires_at FROM log_open_periods WHERE log_date = ?",
            (log_date.isoformat(),),
        ).fetchone()
    if row is None:
        return False
    expires_at = datetime.strptime(row["expires_at"], "%Y-%m-%d %H:%M:%S")
    return now < expires_at


def list_active_log_open_periods(now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT lop.log_date, lop.opened_at, lop.expires_at, u.display_name AS opened_by_name
            FROM log_open_periods lop
            JOIN users u ON u.id = lop.opened_by
            WHERE lop.expires_at > ?
            ORDER BY lop.log_date DESC, lop.expires_at DESC
            """,
            (ts,),
        ).fetchall()
    return [
        {
            "log_date": row["log_date"],
            "opened_at": row["opened_at"],
            "expires_at": row["expires_at"],
            "opened_by_name": row["opened_by_name"],
        }
        for row in rows
    ]


def open_log_date(log_date: str, opened_by: int) -> dict[str, Any]:
    try:
        log_day = datetime.strptime(log_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("日期格式无效") from exc

    today = datetime.now().date()
    if log_day > today:
        raise ValueError("不能开放未来日期的日志")

    opened_at = datetime.now()
    expires_at = opened_at + timedelta(hours=LOG_OPEN_DURATION_HOURS)
    opened_at_text = opened_at.strftime("%Y-%m-%d %H:%M:%S")
    expires_at_text = expires_at.strftime("%Y-%m-%d %H:%M:%S")

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO log_open_periods (log_date, opened_by, opened_at, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(log_date) DO UPDATE SET
                opened_by = excluded.opened_by,
                opened_at = excluded.opened_at,
                expires_at = excluded.expires_at
            """,
            (log_day.isoformat(), opened_by, opened_at_text, expires_at_text),
        )
        row = conn.execute(
            """
            SELECT lop.log_date, lop.opened_at, lop.expires_at, u.display_name AS opened_by_name
            FROM log_open_periods lop
            JOIN users u ON u.id = lop.opened_by
            WHERE lop.log_date = ?
            """,
            (log_day.isoformat(),),
        ).fetchone()
    return {
        "log_date": row["log_date"],
        "opened_at": row["opened_at"],
        "expires_at": row["expires_at"],
        "opened_by_name": row["opened_by_name"],
    }


def is_user_log_date_opened(log_date: date, user_id: int, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT expires_at FROM user_log_open_periods WHERE user_id = ? AND log_date = ?",
            (user_id, log_date.isoformat()),
        ).fetchone()
    if row is None:
        return False
    expires_at = datetime.strptime(row["expires_at"], "%Y-%m-%d %H:%M:%S")
    return now < expires_at


def open_log_date_for_user(user_id: int, log_date: str, opened_by: int) -> dict[str, Any]:
    try:
        log_day = datetime.strptime(log_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("日期格式无效") from exc

    today = datetime.now().date()
    if log_day > today:
        raise ValueError("不能开放未来日期的日志")

    with get_conn() as conn:
        user_row = conn.execute("SELECT id, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row is None:
            raise ValueError("用户不存在")

    opened_at = datetime.now()
    expires_at = opened_at + timedelta(hours=LOG_OPEN_DURATION_HOURS)
    opened_at_text = opened_at.strftime("%Y-%m-%d %H:%M:%S")
    expires_at_text = expires_at.strftime("%Y-%m-%d %H:%M:%S")

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_log_open_periods (user_id, log_date, opened_by, opened_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, log_date) DO UPDATE SET
                opened_by = excluded.opened_by,
                opened_at = excluded.opened_at,
                expires_at = excluded.expires_at
            """,
            (user_id, log_day.isoformat(), opened_by, opened_at_text, expires_at_text),
        )
        row = conn.execute(
            """
            SELECT ulop.user_id, ulop.log_date, ulop.opened_at, ulop.expires_at,
                   u.display_name AS user_display_name,
                   admin.display_name AS opened_by_name
            FROM user_log_open_periods ulop
            JOIN users u ON u.id = ulop.user_id
            JOIN users admin ON admin.id = ulop.opened_by
            WHERE ulop.user_id = ? AND ulop.log_date = ?
            """,
            (user_id, log_day.isoformat()),
        ).fetchone()
    return {
        "user_id": row["user_id"],
        "user_display_name": row["user_display_name"],
        "log_date": row["log_date"],
        "opened_at": row["opened_at"],
        "expires_at": row["expires_at"],
        "opened_by_name": row["opened_by_name"],
    }


def run_auto_approve_pending_logs(now: datetime | None = None) -> int:
    now = now or datetime.now()
    ts = now_text()
    count = 0
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, log_date FROM work_logs WHERE review_status = ?",
            (LOG_REVIEW_PENDING,),
        ).fetchall()
        for row in rows:
            log_day = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
            if now >= get_review_deadline(log_day):
                conn.execute(
                    """
                    UPDATE work_logs
                    SET review_status = ?, reject_reason = '', reviewed_by = NULL,
                        reviewed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (LOG_REVIEW_APPROVED, ts, ts, row["id"]),
                )
                count += 1
    return count


def is_log_editable(log_date: date, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    return now < get_review_deadline(log_date)


def can_user_add_log(log_date: date, now: datetime | None = None, user_id: int | None = None) -> bool:
    now = now or datetime.now()
    today = now.date()
    if log_date > today:
        return False
    if is_log_date_admin_opened(log_date, now):
        return True
    if user_id is not None and is_user_log_date_opened(log_date, user_id, now):
        return True
    if not is_log_editable(log_date, now):
        return False
    if log_date == today:
        return now >= datetime.combine(today, time(LOG_ADD_START_HOUR, 0))
    return True


def can_user_edit_log(review_status: str, log_date: date) -> bool:
    return review_status == LOG_REVIEW_PENDING and is_log_editable(log_date)


def can_user_delete_log(review_status: str, log_date: date) -> bool:
    return can_user_edit_log(review_status, log_date)


def can_user_resubmit_log(review_status: str) -> bool:
    return review_status == LOG_REVIEW_REJECTED


def can_manager_review_log(review_status: str, log_date: date, now: datetime | None = None) -> bool:
    if review_status != LOG_REVIEW_PENDING:
        return False
    now = now or datetime.now()
    return now < get_review_deadline(log_date)


def review_method_label(review_status: str, reviewed_by: int | None) -> str:
    if review_status == LOG_REVIEW_PENDING:
        return ""
    if review_status in {LOG_REVIEW_APPROVED, LOG_REVIEW_REJECTED}:
        return "人工审核" if reviewed_by else "自动审核"
    return ""


def _serialize_work_log(row: sqlite3.Row) -> dict[str, Any]:
    log_date = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
    review_status = row["review_status"]
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "log_date": row["log_date"],
        "weekday": WEEKDAY_NAMES[log_date.weekday()],
        "hours": round_hours(row["hours"]),
        "work_content": row["work_content"],
        "review_status": review_status,
        "review_status_label": {
            LOG_REVIEW_PENDING: "待审核",
            LOG_REVIEW_APPROVED: "已通过",
            LOG_REVIEW_REJECTED: "已驳回",
        }.get(review_status, review_status),
        "reject_reason": row["reject_reason"] or "",
        "reviewed_by": row["reviewed_by"],
        "reviewer_name": row["reviewer_name"] if "reviewer_name" in row.keys() else None,
        "manager_name": row["manager_name"] if "manager_name" in row.keys() else None,
        "reviewed_at": row["reviewed_at"],
        "review_method_label": review_method_label(review_status, row["reviewed_by"]),
        "editable": can_user_edit_log(review_status, log_date),
        "deletable": can_user_delete_log(review_status, log_date),
        "resubmittable": can_user_resubmit_log(review_status),
        "reviewable": can_manager_review_log(review_status, log_date),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _work_log_select() -> str:
    return """
        SELECT wl.*, u.username, u.display_name, p.name AS project_name,
               rv.display_name AS reviewer_name,
               pm.display_name AS manager_name
        FROM work_logs wl
        JOIN users u ON u.id = wl.user_id
        JOIN projects p ON p.id = wl.project_id
        LEFT JOIN users rv ON rv.id = wl.reviewed_by
        LEFT JOIN users pm ON pm.id = p.manager_user_id
    """


def summarize_logs_by_project(logs: list[dict[str, Any]]) -> dict[str, Any]:
    project_map: dict[str, dict[str, Any]] = {}
    total_hours = 0.0
    all_user_ids: set[int] = set()
    valid_logs: list[dict[str, Any]] = []

    for log in logs:
        if log.get("attendance_only"):
            continue
        valid_logs.append(log)
        name = str(log.get("project_name") or "未知项目")
        hours = float(log.get("hours") or 0)
        user_id = log.get("user_id")
        total_hours += hours
        bucket = project_map.setdefault(
            name,
            {"project_name": name, "hours": 0.0, "count": 0, "_user_ids": set()},
        )
        bucket["hours"] += hours
        bucket["count"] += 1
        if user_id is not None:
            uid = int(user_id)
            bucket["_user_ids"].add(uid)
            all_user_ids.add(uid)

    projects = sorted(project_map.values(), key=lambda item: (-item["hours"], item["project_name"]))
    rounded_total = round_hours(total_hours)
    for item in projects:
        item["hours"] = round_hours(item["hours"])
        item["percent"] = round(item["hours"] / rounded_total * 100, 1) if rounded_total else 0.0
        item["user_count"] = len(item.pop("_user_ids"))

    return {
        "total_hours": rounded_total,
        "total_logs": len(valid_logs),
        "total_users": len(all_user_ids),
        "project_count": len(projects),
        "projects": projects,
    }


def list_user_month_logs(user_id: int, year: int, month: int) -> dict[str, Any]:
    run_auto_approve_pending_logs()
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    with get_conn() as conn:
        rows = conn.execute(
            _work_log_select()
            + " WHERE wl.user_id = ? AND wl.log_date BETWEEN ? AND ? ORDER BY wl.log_date, wl.created_at, wl.id",
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchall()

    days: list[dict[str, Any]] = []
    current = start
    logs_by_date: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = _serialize_work_log(row)
        logs_by_date.setdefault(item["log_date"], []).append(item)

    while current <= end:
        key = current.isoformat()
        days.append(
            {
                "date": key,
                "day": current.day,
                "weekday": WEEKDAY_NAMES[current.weekday()],
                "editable": is_log_editable(current),
                "addable": can_user_add_log(current, user_id=user_id),
                "logs": logs_by_date.get(key, []),
            }
        )
        current += timedelta(days=1)

    all_logs = [log for day in days for log in day["logs"]]
    summary = summarize_logs_by_project(all_logs)

    return {"year": year, "month": month, "days": days, "summary": summary}


def create_work_log(user_id: int, project_id: int, log_date: str, hours: float, work_content: str) -> dict[str, Any]:
    log_day = datetime.strptime(log_date, "%Y-%m-%d").date()
    if not can_user_add_log(log_day, user_id=user_id):
        now = datetime.now()
        if log_day == now.date() and now < datetime.combine(log_day, time(LOG_ADD_START_HOUR, 0)):
            raise ValueError("请在当天下午 17:00 之后再新增日志")
        if log_day > now.date():
            raise ValueError("不能为未来日期新增日志")
        raise ValueError("该日期暂不可新增日志")

    project = get_project(project_id, enabled_only=True)
    if project is None:
        raise ValueError("项目不存在或已禁用")

    hours = round_hours(hours)
    if hours <= 0:
        raise ValueError("工时必须大于 0")

    ts = now_text()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO work_logs (
                user_id, project_id, log_date, hours, work_content,
                review_status, reject_reason, reviewed_by, reviewed_at,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, '', NULL, NULL, ?, ?)
            """,
            (user_id, project_id, log_date, hours, work_content.strip(), LOG_REVIEW_PENDING, ts, ts),
        )
        log_id = cur.lastrowid
        row = conn.execute(_work_log_select() + " WHERE wl.id = ?", (log_id,)).fetchone()
    return _serialize_work_log(row)


def _build_project_id_lookup() -> dict[str, int]:
    lookup: dict[str, int] = {}
    for project in list_projects(include_disabled=True):
        project_id = int(project["id"])
        name = str(project["name"]).strip()
        if name:
            lookup[name] = project_id
            lookup[name.lower()] = project_id
        for alias in project.get("aliases") or []:
            alias_text = str(alias).strip()
            if alias_text:
                lookup[alias_text] = project_id
                lookup[alias_text.lower()] = project_id
    return lookup


def import_historical_work_logs(records: list[dict[str, Any]]) -> dict[str, Any]:
    users = list_users()
    user_lookup = _build_user_name_lookup(users)
    project_lookup = _build_project_id_lookup()
    today = date.today()
    ts = now_text()

    imported_count = 0
    updated_count = 0
    skipped_users: set[str] = set()
    skipped_projects: set[str] = set()
    skipped_future = 0

    with get_conn() as conn:
        for record in records:
            display_name = str(record.get("姓名", "")).strip()
            project_name = str(record.get("项目", "")).strip()
            if not display_name or not project_name:
                continue

            user_id = user_lookup.get(display_name)
            if user_id is None:
                skipped_users.add(display_name)
                continue

            project_id = project_lookup.get(project_name) or project_lookup.get(project_name.lower())
            if project_id is None:
                skipped_projects.add(project_name)
                continue

            date_value = record.get("日期")
            if hasattr(date_value, "date"):
                log_day = date_value.date()
            else:
                log_day = datetime.strptime(str(date_value)[:10], "%Y-%m-%d").date()
            log_date = log_day.isoformat()

            if log_day > today:
                skipped_future += 1
                continue

            hours = round_hours(float(record.get("工时（小时）", 0)))
            if hours <= 0:
                continue
            work_content = str(record.get("工作内容", "")).strip()

            if log_day < today:
                review_status = LOG_REVIEW_APPROVED
                reviewed_at = ts
            else:
                review_status = LOG_REVIEW_PENDING
                reviewed_at = None

            existing = conn.execute(
                """
                SELECT id FROM work_logs
                WHERE user_id = ? AND project_id = ? AND log_date = ?
                """,
                (user_id, project_id, log_date),
            ).fetchone()

            if existing:
                conn.execute(
                    """
                    UPDATE work_logs
                    SET hours = ?, work_content = ?, review_status = ?, reject_reason = '',
                        reviewed_by = NULL, reviewed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (hours, work_content, review_status, reviewed_at, ts, existing["id"]),
                )
                updated_count += 1
            else:
                conn.execute(
                    """
                    INSERT INTO work_logs (
                        user_id, project_id, log_date, hours, work_content,
                        review_status, reject_reason, reviewed_by, reviewed_at,
                        created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?)
                    """,
                    (
                        user_id,
                        project_id,
                        log_date,
                        hours,
                        work_content,
                        review_status,
                        reviewed_at,
                        ts,
                        ts,
                    ),
                )
                imported_count += 1

    if imported_count == 0 and updated_count == 0:
        raise ValueError("没有可导入的日志记录，请检查人员、项目匹配情况")

    return {
        "imported_count": imported_count,
        "updated_count": updated_count,
        "skipped_users": sorted(skipped_users),
        "skipped_projects": sorted(skipped_projects),
        "skipped_future": skipped_future,
    }


def update_work_log(log_id: int, user_id: int, hours: float, work_content: str, is_admin: bool = False) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM work_logs WHERE id = ?", (log_id,)).fetchone()
        if row is None:
            raise ValueError("日志不存在")
        if not is_admin and row["user_id"] != user_id:
            raise ValueError("无权修改该日志")
        review_status = row["review_status"]
        log_day = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
        if not is_admin and not can_user_edit_log(review_status, log_day):
            raise ValueError("该日志当前不可编辑")

        hours = round_hours(hours)
        if hours <= 0:
            raise ValueError("工时必须大于 0")

        conn.execute(
            """
            UPDATE work_logs SET hours = ?, work_content = ?, updated_at = ? WHERE id = ?
            """,
            (hours, work_content.strip(), now_text(), log_id),
        )
        updated = conn.execute(_work_log_select() + " WHERE wl.id = ?", (log_id,)).fetchone()
    return _serialize_work_log(updated)


def delete_work_log(log_id: int, user_id: int, is_admin: bool = False) -> None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM work_logs WHERE id = ?", (log_id,)).fetchone()
        if row is None:
            raise ValueError("日志不存在")
        if not is_admin and row["user_id"] != user_id:
            raise ValueError("无权删除该日志")
        review_status = row["review_status"]
        log_day = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
        if not is_admin and not can_user_delete_log(review_status, log_day):
            raise ValueError("该日志当前不可删除")
        conn.execute("DELETE FROM work_logs WHERE id = ?", (log_id,))


def admin_delete_work_log(log_id: int, admin_id: int) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT user_id, log_date FROM work_logs WHERE id = ?", (log_id,)).fetchone()
        if row is None:
            raise ValueError("日志不存在")
        target_user_id = int(row["user_id"])
        log_date = row["log_date"]
        conn.execute("DELETE FROM work_logs WHERE id = ?", (log_id,))

    open_period = open_log_date_for_user(target_user_id, log_date, admin_id)
    return {
        "user_id": target_user_id,
        "log_date": log_date,
        "open_period": open_period,
    }


def resubmit_work_log(log_id: int, user_id: int, hours: float, work_content: str) -> dict[str, Any]:
    hours = round_hours(hours)
    if hours <= 0:
        raise ValueError("工时必须大于 0")

    ts = now_text()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM work_logs WHERE id = ?", (log_id,)).fetchone()
        if row is None:
            raise ValueError("日志不存在")
        if row["user_id"] != user_id:
            raise ValueError("无权重新提交该日志")
        if row["review_status"] != LOG_REVIEW_REJECTED:
            raise ValueError("仅被驳回的日志可以重新提交")

        conn.execute(
            """
            UPDATE work_logs
            SET hours = ?, work_content = ?, review_status = ?, reject_reason = '',
                reviewed_by = NULL, reviewed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (hours, work_content.strip(), LOG_REVIEW_PENDING, ts, log_id),
        )
        updated = conn.execute(_work_log_select() + " WHERE wl.id = ?", (log_id,)).fetchone()
    return _serialize_work_log(updated)


def _manager_project_ids(conn: sqlite3.Connection, manager_user_id: int) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM projects WHERE manager_user_id = ?",
        (manager_user_id,),
    ).fetchall()
    return [row["id"] for row in rows]


def _ensure_manager_for_log(conn: sqlite3.Connection, log_id: int, manager_user_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT wl.*, p.manager_user_id
        FROM work_logs wl
        JOIN projects p ON p.id = wl.project_id
        WHERE wl.id = ?
        """,
        (log_id,),
    ).fetchone()
    if row is None:
        raise ValueError("日志不存在")
    if row["manager_user_id"] != manager_user_id:
        raise ValueError("无权审核该日志")
    return row


def approve_work_log(log_id: int, manager_user_id: int) -> dict[str, Any]:
    run_auto_approve_pending_logs()
    ts = now_text()
    with get_conn() as conn:
        row = _ensure_manager_for_log(conn, log_id, manager_user_id)
        log_day = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
        if not can_manager_review_log(row["review_status"], log_day):
            raise ValueError("该日志当前不可审核")
        conn.execute(
            """
            UPDATE work_logs
            SET review_status = ?, reject_reason = '', reviewed_by = ?, reviewed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (LOG_REVIEW_APPROVED, manager_user_id, ts, ts, log_id),
        )
        updated = conn.execute(_work_log_select() + " WHERE wl.id = ?", (log_id,)).fetchone()
    return _serialize_work_log(updated)


def reject_work_log(log_id: int, manager_user_id: int, reason: str = "") -> dict[str, Any]:
    run_auto_approve_pending_logs()
    ts = now_text()
    with get_conn() as conn:
        row = _ensure_manager_for_log(conn, log_id, manager_user_id)
        log_day = datetime.strptime(row["log_date"], "%Y-%m-%d").date()
        if not can_manager_review_log(row["review_status"], log_day):
            raise ValueError("该日志当前不可审核")
        conn.execute(
            """
            UPDATE work_logs
            SET review_status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (LOG_REVIEW_REJECTED, reason.strip(), manager_user_id, ts, ts, log_id),
        )
        updated = conn.execute(_work_log_select() + " WHERE wl.id = ?", (log_id,)).fetchone()
    return _serialize_work_log(updated)


def list_managed_projects(manager_user_id: int) -> list[dict[str, Any]]:
    projects = list_projects(include_disabled=True)
    return [project for project in projects if project.get("manager_user_id") == manager_user_id]


def list_review_user_options(manager_user_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        project_ids = _manager_project_ids(conn, manager_user_id)
        if not project_ids:
            return []
        placeholders = ",".join("?" * len(project_ids))
        rows = conn.execute(
            f"""
            SELECT DISTINCT u.id, u.username, u.display_name
            FROM work_logs wl
            JOIN users u ON u.id = wl.user_id
            WHERE wl.project_id IN ({placeholders})
            ORDER BY u.display_name, u.username
            """,
            project_ids,
        ).fetchall()
    return [dict(row) for row in rows]


def query_review_logs(
    manager_user_id: int,
    *,
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    user_id: int | None = None,
    user_name: str = "",
    project_id: int | None = None,
    project_name: str = "",
    review_status: str = "",
) -> list[dict[str, Any]]:
    run_auto_approve_pending_logs()
    with get_conn() as conn:
        project_ids = _manager_project_ids(conn, manager_user_id)
    if not project_ids:
        return []

    logs = query_work_logs(
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=user_name,
        project_id=project_id,
        project_name=project_name,
        project_ids=project_ids,
        review_status=review_status,
        approved_only=False,
    )
    return logs


def query_work_logs(
    *,
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    user_id: int | None = None,
    user_name: str = "",
    project_id: int | None = None,
    project_name: str = "",
    project_ids: list[int] | None = None,
    review_status: str = "",
    approved_only: bool = False,
) -> list[dict[str, Any]]:
    if approved_only:
        run_auto_approve_pending_logs()

    conditions = ["1=1"]
    params: list[Any] = []

    if year and month and day:
        conditions.append("wl.log_date = ?")
        params.append(date(year, month, day).isoformat())
    elif year and month:
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
        conditions.append("wl.log_date BETWEEN ? AND ?")
        params.extend([start.isoformat(), end.isoformat()])
    elif year:
        conditions.append("wl.log_date BETWEEN ? AND ?")
        params.extend([date(year, 1, 1).isoformat(), date(year, 12, 31).isoformat()])

    if user_id:
        conditions.append("wl.user_id = ?")
        params.append(user_id)
    elif user_name.strip():
        conditions.append("(u.username LIKE ? OR u.display_name LIKE ?)")
        params.extend([f"%{user_name.strip()}%", f"%{user_name.strip()}%"])

    if project_id:
        conditions.append("wl.project_id = ?")
        params.append(project_id)
    elif project_ids:
        placeholders = ",".join("?" for _ in project_ids)
        conditions.append(f"wl.project_id IN ({placeholders})")
        params.extend(project_ids)
    elif project_name.strip():
        conditions.append("p.name LIKE ?")
        params.append(f"%{project_name.strip()}%")

    if review_status:
        conditions.append("wl.review_status = ?")
        params.append(review_status)
    elif approved_only:
        conditions.append("wl.review_status = ?")
        params.append(LOG_REVIEW_APPROVED)

    query = _work_log_select() + " WHERE " + " AND ".join(conditions) + " ORDER BY wl.log_date, u.display_name, wl.created_at, wl.id"

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_serialize_work_log(row) for row in rows]


def _build_user_name_lookup(users: list[dict[str, Any]]) -> dict[str, int]:
    lookup: dict[str, int] = {}
    for user in users:
        for key in (user.get("display_name"), user.get("username")):
            text = str(key or "").strip()
            if text and text not in lookup:
                lookup[text] = int(user["id"])
    return lookup


def import_attendance_records(records: list[dict[str, str]]) -> dict[str, Any]:
    users = list_users()
    lookup = _build_user_name_lookup(users)
    ts = now_text()

    parsed: list[tuple[int, str, str]] = []
    skipped_names: set[str] = set()
    user_date_ranges: dict[int, tuple[str, str]] = {}

    for record in records:
        name = str(record.get("name", "")).strip()
        attendance_date = str(record.get("date", "")).strip()
        attendance_text = str(record.get("text", "")).strip()
        if not name or not attendance_date or not attendance_text:
            continue

        user_id = lookup.get(name)
        if user_id is None:
            skipped_names.add(name)
            continue

        parsed.append((user_id, attendance_date, attendance_text))
        current_range = user_date_ranges.get(user_id)
        if current_range is None:
            user_date_ranges[user_id] = (attendance_date, attendance_date)
        else:
            user_date_ranges[user_id] = (
                min(current_range[0], attendance_date),
                max(current_range[1], attendance_date),
            )

    if not parsed:
        raise ValueError("没有可导入的考勤记录，请检查 Excel 姓名是否与系统姓名或用户名一致")

    with get_conn() as conn:
        for user_id, (start_date, end_date) in user_date_ranges.items():
            conn.execute(
                """
                DELETE FROM attendance_records
                WHERE user_id = ? AND attendance_date BETWEEN ? AND ?
                """,
                (user_id, start_date, end_date),
            )

        for user_id, attendance_date, attendance_text in parsed:
            conn.execute(
                """
                INSERT INTO attendance_records (
                    user_id, attendance_date, attendance_text, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, attendance_date) DO UPDATE SET
                    attendance_text = excluded.attendance_text,
                    updated_at = excluded.updated_at
                """,
                (user_id, attendance_date, attendance_text, ts, ts),
            )

    return {
        "imported_count": len(parsed),
        "matched_users": len(user_date_ranges),
        "skipped_names": sorted(skipped_names),
    }


def query_attendance_records(
    *,
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
    user_id: int | None = None,
    user_name: str = "",
) -> list[dict[str, Any]]:
    conditions = ["1=1"]
    params: list[Any] = []

    if year and month and day:
        conditions.append("ar.attendance_date = ?")
        params.append(date(year, month, day).isoformat())
    elif year and month:
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
        conditions.append("ar.attendance_date BETWEEN ? AND ?")
        params.extend([start.isoformat(), end.isoformat()])
    elif year:
        conditions.append("ar.attendance_date BETWEEN ? AND ?")
        params.extend([date(year, 1, 1).isoformat(), date(year, 12, 31).isoformat()])

    if user_id:
        conditions.append("ar.user_id = ?")
        params.append(user_id)
    elif user_name.strip():
        conditions.append("(u.username LIKE ? OR u.display_name LIKE ?)")
        params.extend([f"%{user_name.strip()}%", f"%{user_name.strip()}%"])

    query = f"""
        SELECT ar.user_id, ar.attendance_date, ar.attendance_text,
               u.username, u.display_name
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        WHERE {" AND ".join(conditions)}
        ORDER BY ar.attendance_date, u.display_name, ar.id
    """

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()

    result = []
    for row in rows:
        attendance_day = datetime.strptime(row["attendance_date"], "%Y-%m-%d").date()
        result.append(
            {
                "user_id": row["user_id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "attendance_date": row["attendance_date"],
                "weekday": WEEKDAY_NAMES[attendance_day.weekday()],
                "attendance": row["attendance_text"],
            }
        )
    return result


def merge_admin_logs_with_attendance(
    logs: list[dict[str, Any]],
    attendance_rows: list[dict[str, Any]],
    *,
    include_attendance_only: bool = True,
) -> list[dict[str, Any]]:
    attendance_map: dict[tuple[int, str], str] = {}
    user_info: dict[int, dict[str, Any]] = {}
    for row in attendance_rows:
        key = (int(row["user_id"]), row["attendance_date"])
        attendance_map[key] = row["attendance"]
        user_info[int(row["user_id"])] = row

    merged: list[dict[str, Any]] = []
    covered_keys: set[tuple[int, str]] = set()

    for log in logs:
        key = (int(log["user_id"]), log["log_date"])
        covered_keys.add(key)
        item = dict(log)
        item["attendance"] = attendance_map.get(key, "")
        item["attendance_only"] = False
        merged.append(item)

    if include_attendance_only:
        for key, attendance_text in attendance_map.items():
            if key in covered_keys:
                continue
            user_id, log_date = key
            info = user_info[user_id]
            log_day = datetime.strptime(log_date, "%Y-%m-%d").date()
            merged.append(
                {
                    "id": None,
                    "user_id": user_id,
                    "username": info["username"],
                    "display_name": info["display_name"],
                    "project_id": None,
                    "project_name": "/",
                    "log_date": log_date,
                    "weekday": WEEKDAY_NAMES[log_day.weekday()],
                    "hours": "-",
                    "work_content": "/",
                    "attendance": attendance_text,
                    "attendance_only": True,
                    "review_status": "",
                    "review_status_label": "",
                    "review_method_label": "",
                    "reject_reason": "",
                    "reviewed_by": None,
                    "reviewer_name": None,
                    "manager_name": None,
                    "reviewed_at": None,
                    "editable": False,
                    "deletable": False,
                    "resubmittable": False,
                    "reviewable": False,
                    "created_at": "",
                    "updated_at": "",
                }
            )

    merged.sort(
        key=lambda item: (
            item["log_date"],
            item.get("display_name") or "",
            0 if item.get("attendance_only") else 1,
            item.get("id") or 0,
        )
    )
    return merged
