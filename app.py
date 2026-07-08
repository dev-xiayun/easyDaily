#!/usr/bin/env python3
"""日志统计 Web 服务。"""

from __future__ import annotations

import io
import os
import threading
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.utils import secure_filename

from attendance_import import parse_attendance_excel
from auth import admin_required, approved_user_required, login_required, manager_required
from captcha import build_captcha_svg, clear_captcha, generate_captcha_code, store_captcha, verify_captcha
from convert_logs import build_convert_result, records_to_excel_bytes
from log_import import import_logs_from_excel
from legacy_log_import import import_legacy_system_logs_from_excel
from database import (
    ROLE_ADMIN,
    approve_work_log,
    authenticate,
    admin_delete_work_log,
    create_project,
    create_work_log,
    delete_work_log,
    enrich_user,
    get_flat_project_mapping,
    import_attendance_records,
    init_db,
    list_approved_users,
    list_managed_projects,
    list_review_user_options,
    list_projects,
    list_user_month_logs,
    list_active_log_open_periods,
    merge_admin_logs_with_attendance,
    open_log_date,
    query_admin_users,
    query_review_logs,
    query_attendance_records,
    query_work_logs,
    register_user,
    reject_work_log,
    resubmit_work_log,
    review_method_label,
    save_projects,
    summarize_admin_projects,
    summarize_admin_users,
    summarize_logs_by_project,
    update_user_status,
    update_user_profile,
    admin_set_user_password,
    update_work_log,
)
from history_store import delete_history, get_history, list_history, save_history

BASE_DIR = Path(__file__).resolve().parent
CACHE: dict[str, dict] = {}
CACHE_TTL_SECONDS = 3600

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dailay-converter-local-dev-secret")

init_db()


def cleanup_cache() -> None:
    now = time.time()
    expired = [token for token, item in CACHE.items() if now - item["created_at"] > CACHE_TTL_SECONDS]
    for token in expired:
        CACHE.pop(token, None)


def restore_records(records: list[dict]) -> list[dict]:
    restored = []
    for record in records:
        item = dict(record)
        date_value = item.get("日期")
        if isinstance(date_value, str):
            item["日期"] = datetime.strptime(date_value, "%Y-%m-%d")
        restored.append(item)
    return restored


def cache_records(token: str, filename: str, sheet_name: str, records: list[dict]) -> None:
    CACHE[token] = {
        "created_at": time.time(),
        "filename": filename,
        "sheet_name": sheet_name,
        "records": records,
    }


def current_user() -> dict | None:
    return session.get("user")


def export_query_logs_excel(logs: list[dict]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "日志查询"
    headers = ["姓名", "用户名", "日期", "星期", "项目", "工时（小时）", "工作内容", "考勤", "审核方式", "审核人", "创建时间"]
    ws.append(headers)
    for item in logs:
        review_label = ""
        manager_name = ""
        if not item.get("attendance_only"):
            review_label = item.get("review_method_label") or review_method_label(
                str(item.get("review_status") or ""),
                item.get("reviewed_by"),
            )
            manager_name = item.get("manager_name") or ""
        ws.append(
            [
                item["display_name"],
                item["username"],
                item["log_date"],
                item["weekday"],
                item["project_name"],
                item["hours"],
                item["work_content"],
                item.get("attendance", ""),
                review_label,
                manager_name,
                item["created_at"],
            ]
        )
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


@app.route("/")
def root():
    user = current_user()
    if not user:
        return redirect(url_for("login_page"))
    if user.get("role") == ROLE_ADMIN:
        return redirect(url_for("admin_logs_page"))
    return redirect(url_for("my_logs_page"))


@app.route("/login")
def login_page():
    if current_user():
        return redirect(url_for("root"))
    return render_template("login.html")


@app.route("/register")
def register_page():
    if current_user():
        return redirect(url_for("root"))
    return render_template("register.html")


@app.route("/my-logs")
@approved_user_required
def my_logs_page():
    user = enrich_user(current_user())
    session["user"] = user
    return render_template("my_logs.html", user=user)


@app.route("/log-review")
@manager_required
def log_review_page():
    user = enrich_user(current_user())
    session["user"] = user
    return render_template("log_review.html", user=user)


@app.route("/m/my-logs")
@approved_user_required
def mobile_my_logs_page():
    user = enrich_user(current_user())
    if user.get("role") == ROLE_ADMIN:
        return redirect(url_for("admin_logs_page"))
    session["user"] = user
    return render_template("mobile/my_logs.html", user=user)


@app.route("/m/log-review")
@manager_required
def mobile_log_review_page():
    user = enrich_user(current_user())
    session["user"] = user
    return render_template("mobile/log_review.html", user=user)


@app.route("/admin/users")
@admin_required
def admin_users_page():
    return render_template("admin_users.html", user=current_user())


@app.route("/admin/projects")
@admin_required
def admin_projects_page():
    return render_template("admin_projects.html", user=current_user())


@app.route("/admin/logs")
@admin_required
def admin_logs_page():
    return render_template("admin_logs.html", user=current_user())


@app.route("/admin/convert")
@admin_required
def admin_convert_page():
    return render_template("admin_convert.html", user=current_user())


@app.route("/api/auth/captcha", methods=["GET"])
def api_auth_captcha():
    code = generate_captcha_code()
    store_captcha(session, code)
    svg = build_captcha_svg(code)
    return svg, 200, {"Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store"}


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    captcha = str(payload.get("captcha", "")).strip()

    if not captcha:
        return jsonify({"error": "请输入验证码"}), 400
    if not verify_captcha(session, captcha):
        clear_captcha(session)
        return jsonify({"error": "验证码错误或已过期"}), 400

    clear_captcha(session)
    user = authenticate(username, password)
    if user is None:
        return jsonify({"error": "用户名或密码错误，或账号尚未通过审核"}), 401

    user = enrich_user(user)
    session["user"] = user
    return jsonify({"message": "登录成功", "user": user})


@app.route("/api/auth/register", methods=["POST"])
def api_register():
    payload = request.get_json(silent=True) or {}
    try:
        user = register_user(
            username=str(payload.get("username", "")).strip(),
            password=str(payload.get("password", "")),
            display_name=str(payload.get("display_name", "")).strip(),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "注册成功，请等待管理员审核", "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.pop("user", None)
    return jsonify({"message": "已退出登录"})


@app.route("/api/auth/me")
def api_me():
    user = current_user()
    if not user:
        return jsonify({"user": None})
    user = enrich_user(user)
    session["user"] = user
    return jsonify({"user": user})


@app.route("/api/auth/profile", methods=["PUT"])
@approved_user_required
def api_update_profile():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    password = str(payload.get("password", ""))
    confirm_password = str(payload.get("confirm_password", ""))
    try:
        if password or confirm_password:
            if password != confirm_password:
                raise ValueError("两次输入的密码不一致")
        profile_password = password if password else None
        updated = update_user_profile(
            user["id"],
            display_name=str(payload.get("display_name", "")).strip(),
            password=profile_password,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    updated = enrich_user(updated)
    session["user"] = updated
    return jsonify({"message": "保存成功", "user": updated})


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def api_admin_users():
    keyword = request.args.get("keyword", "")
    role = request.args.get("role", "")
    status = request.args.get("status", "")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("page_size", 50, type=int)
    return jsonify(
        query_admin_users(
            keyword=keyword,
            role=role,
            status=status,
            page=page,
            page_size=page_size,
        )
    )


@app.route("/api/admin/users/summary", methods=["GET"])
@admin_required
def api_admin_users_summary():
    return jsonify({"summary": summarize_admin_users()})


@app.route("/api/admin/users/<int:user_id>/status", methods=["PUT"])
@admin_required
def api_admin_user_status(user_id: int):
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).strip()
    try:
        user = update_user_status(user_id, status)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if user is None:
        return jsonify({"error": "用户不存在"}), 404
    return jsonify({"message": "更新成功", "user": user})


@app.route("/api/admin/users/<int:user_id>/password", methods=["PUT"])
@admin_required
def api_admin_user_password(user_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        user = admin_set_user_password(
            user_id,
            password=str(payload.get("password", "")),
            confirm_password=str(payload.get("confirm_password", "")),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "密码设置成功", "user": user})


@app.route("/api/admin/users/<int:user_id>/display_name", methods=["PUT"])
@admin_required
def api_admin_user_display_name(user_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        user = update_user_profile(
            user_id,
            display_name=str(payload.get("display_name", "")).strip(),
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "姓名已更新", "user": user})


@app.route("/api/admin/projects", methods=["GET"])
@admin_required
def api_admin_projects():
    keyword = request.args.get("keyword", "")
    status = request.args.get("status", "")
    return jsonify({"items": list_projects(include_disabled=True, keyword=keyword, status=status)})


@app.route("/api/admin/projects/summary", methods=["GET"])
@admin_required
def api_admin_projects_summary():
    keyword = request.args.get("keyword", "")
    status = request.args.get("status", "")
    return jsonify({"summary": summarize_admin_projects(keyword=keyword, status=status)})


@app.route("/api/admin/projects", methods=["PUT"])
@admin_required
def api_admin_save_projects():
    payload = request.get_json(silent=True) or {}
    projects = payload.get("projects")
    if not isinstance(projects, list):
        return jsonify({"error": "projects 必须是数组"}), 400
    try:
        save_projects(projects)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "保存成功", "items": list_projects(include_disabled=True)})


@app.route("/api/admin/projects", methods=["POST"])
@admin_required
def api_admin_create_project():
    payload = request.get_json(silent=True) or {}
    try:
        manager_user_id = payload.get("manager_user_id")
        if manager_user_id in ("", None):
            manager_user_id = None
        else:
            manager_user_id = int(manager_user_id)
        aliases = payload.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [part.strip() for part in aliases.replace("；", ";").split(";") if part.strip()]
        project = create_project(
            name=str(payload.get("name", "")).strip(),
            aliases=aliases,
            manager_user_id=manager_user_id,
            status=str(payload.get("status", "enabled")).strip() or "enabled",
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "创建成功", "project": project})


@app.route("/api/projects/enabled", methods=["GET"])
@approved_user_required
def api_enabled_projects():
    keyword = request.args.get("keyword", "")
    return jsonify({"items": list_projects(include_disabled=False, keyword=keyword)})


@app.route("/api/my/logs", methods=["GET"])
@approved_user_required
def api_my_logs():
    user = current_user()
    try:
        year = int(request.args.get("year", datetime.now().year))
        month = int(request.args.get("month", datetime.now().month))
    except ValueError:
        return jsonify({"error": "年月参数无效"}), 400
    data = list_user_month_logs(user["id"], year, month)
    return jsonify(data)


@app.route("/api/my/logs", methods=["POST"])
@approved_user_required
def api_create_log():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    try:
        log = create_work_log(
            user_id=user["id"],
            project_id=int(payload.get("project_id")),
            log_date=str(payload.get("log_date")),
            hours=float(payload.get("hours")),
            work_content=str(payload.get("work_content", "")),
        )
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "添加成功", "log": log})


@app.route("/api/my/logs/<int:log_id>", methods=["PUT"])
@approved_user_required
def api_update_log(log_id: int):
    user = current_user()
    payload = request.get_json(silent=True) or {}
    try:
        log = update_work_log(
            log_id=log_id,
            user_id=user["id"],
            hours=float(payload.get("hours")),
            work_content=str(payload.get("work_content", "")),
            is_admin=user.get("role") == ROLE_ADMIN,
        )
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "更新成功", "log": log})


@app.route("/api/my/logs/<int:log_id>", methods=["DELETE"])
@approved_user_required
def api_delete_log(log_id: int):
    user = current_user()
    try:
        delete_work_log(log_id, user["id"], is_admin=user.get("role") == ROLE_ADMIN)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "删除成功"})


@app.route("/api/my/logs/<int:log_id>/resubmit", methods=["POST"])
@approved_user_required
def api_resubmit_log(log_id: int):
    user = current_user()
    payload = request.get_json(silent=True) or {}
    try:
        log = resubmit_work_log(
            log_id=log_id,
            user_id=user["id"],
            hours=float(payload.get("hours")),
            work_content=str(payload.get("work_content", "")),
        )
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "重新提交成功，等待审核", "log": log})


@app.route("/api/review/logs", methods=["GET"])
@manager_required
def api_review_logs():
    user = current_user()
    try:
        year = int(request.args["year"]) if request.args.get("year") else None
        month = int(request.args["month"]) if request.args.get("month") else None
        day = int(request.args["day"]) if request.args.get("day") else None
        user_id = int(request.args["user_id"]) if request.args.get("user_id") else None
        project_id = int(request.args["project_id"]) if request.args.get("project_id") else None
    except ValueError:
        return jsonify({"error": "查询参数无效"}), 400

    logs = query_review_logs(
        user["id"],
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=request.args.get("user_name", ""),
        project_id=project_id,
        project_name=request.args.get("project_name", ""),
        review_status=request.args.get("review_status", ""),
    )
    summary = summarize_logs_by_project(logs)
    return jsonify({"items": logs, "summary": summary, "projects": list_managed_projects(user["id"])})


@app.route("/api/review/logs/<int:log_id>/approve", methods=["POST"])
@manager_required
def api_approve_log(log_id: int):
    user = current_user()
    try:
        log = approve_work_log(log_id, user["id"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "审核通过", "log": log})


@app.route("/api/review/logs/<int:log_id>/reject", methods=["POST"])
@manager_required
def api_reject_log(log_id: int):
    user = current_user()
    payload = request.get_json(silent=True) or {}
    try:
        log = reject_work_log(log_id, user["id"], str(payload.get("reason", "")))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"message": "已驳回", "log": log})


@app.route("/api/review/options/projects", methods=["GET"])
@manager_required
def api_review_project_options():
    user = current_user()
    return jsonify({"items": list_managed_projects(user["id"])})


@app.route("/api/review/options/users", methods=["GET"])
@manager_required
def api_review_user_options():
    user = current_user()
    return jsonify({"items": list_review_user_options(user["id"])})


@app.route("/api/admin/logs", methods=["GET"])
@admin_required
def api_admin_query_logs():
    try:
        year = int(request.args["year"]) if request.args.get("year") else None
        month = int(request.args["month"]) if request.args.get("month") else None
        day = int(request.args["day"]) if request.args.get("day") else None
        user_id = int(request.args["user_id"]) if request.args.get("user_id") else None
        project_id = int(request.args["project_id"]) if request.args.get("project_id") else None
    except ValueError:
        return jsonify({"error": "查询参数无效"}), 400

    user_name = request.args.get("user_name", "")
    project_name = request.args.get("project_name", "")
    has_project_filter = bool(project_id or project_name.strip())

    logs = query_work_logs(
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=user_name,
        project_id=project_id,
        project_name=project_name,
        approved_only=True,
    )
    attendance_rows = query_attendance_records(
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=user_name,
    )
    items = merge_admin_logs_with_attendance(
        logs,
        attendance_rows,
        include_attendance_only=not has_project_filter,
    )
    summary = summarize_logs_by_project(logs)
    return jsonify({"items": items, "summary": summary})


@app.route("/api/admin/logs/open", methods=["GET"])
@admin_required
def api_admin_list_log_open_periods():
    return jsonify({"items": list_active_log_open_periods()})


@app.route("/api/admin/logs/open", methods=["POST"])
@admin_required
def api_admin_open_log_date():
    payload = request.get_json(silent=True) or {}
    log_date = str(payload.get("log_date", "")).strip()
    if not log_date:
        return jsonify({"error": "请选择开放日期"}), 400
    user = current_user()
    try:
        period = open_log_date(log_date, user["id"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(
        {
            "message": f"已开放 {period['log_date']} 的日志填报，有效期至 {period['expires_at']}",
            "period": period,
        }
    )


@app.route("/api/admin/logs/<int:log_id>", methods=["DELETE"])
@admin_required
def api_admin_delete_log(log_id: int):
    user = current_user()
    try:
        result = admin_delete_work_log(log_id, user["id"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    period = result["open_period"]
    return jsonify(
        {
            "message": (
                f"已删除 {period['user_display_name']} 在 {result['log_date']} 的日志，"
                f"并已为该人员单独开放至 {period['expires_at']}"
            ),
            **result,
        }
    )


@app.route("/api/admin/attendance/import", methods=["POST"])
@admin_required
def api_admin_import_attendance():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "请上传考勤 Excel 文件"}), 400

    filename = upload.filename.lower()
    if not filename.endswith((".xlsx", ".xls")):
        return jsonify({"error": "仅支持 .xlsx 或 .xls 文件"}), 400

    try:
        records = parse_attendance_excel(upload.read())
        result = import_attendance_records(records)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(
        {
            "message": f"考勤导入成功，共 {result['imported_count']} 条",
            **result,
        }
    )


@app.route("/api/admin/logs/import", methods=["POST"])
@admin_required
def api_admin_import_logs():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "请上传日志 Excel 文件"}), 400

    filename = upload.filename.lower()
    if not filename.endswith((".xlsx", ".xls")):
        return jsonify({"error": "仅支持 .xlsx 或 .xls 文件"}), 400

    year_raw = request.form.get("year", "").strip()
    if not year_raw:
        return jsonify({"error": "请指定导入年份"}), 400
    try:
        year = int(year_raw)
    except ValueError:
        return jsonify({"error": "导入年份无效"}), 400

    try:
        result = import_logs_from_excel(upload.read(), year)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    skipped_users = len(result.get("skipped_users") or [])
    skipped_projects = len(result.get("skipped_projects") or [])
    extra_parts = []
    if skipped_users:
        extra_parts.append(f"{skipped_users} 个姓名未匹配")
    if skipped_projects:
        extra_parts.append(f"{skipped_projects} 个项目未匹配")
    if result.get("skipped_future"):
        extra_parts.append(f"{result['skipped_future']} 条未来日期已跳过")
    extra = f"（{ '，'.join(extra_parts)}）" if extra_parts else ""

    return jsonify(
        {
            "message": (
                f"日志导入完成：新增 {result['imported_count']} 条，"
                f"更新 {result['updated_count']} 条"
            ),
            **result,
            "extra": extra,
        }
    )


@app.route("/api/admin/logs/import-legacy", methods=["POST"])
@admin_required
def api_admin_import_legacy_logs():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "请上传原系统日志 Excel 文件"}), 400

    filename = upload.filename.lower()
    if not filename.endswith((".xlsx", ".xls")):
        return jsonify({"error": "仅支持 .xlsx 或 .xls 文件"}), 400

    try:
        result = import_legacy_system_logs_from_excel(upload.read())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    created_users = result.get("created_users") or []
    extra_parts = []
    if created_users:
        extra_parts.append(f"自动创建 {len(created_users)} 个禁用账号")
    if result.get("skipped_future"):
        extra_parts.append(f"{result['skipped_future']} 条未来日期已跳过")
    extra = f"（{ '，'.join(extra_parts)}）" if extra_parts else ""

    return jsonify(
        {
            "message": (
                f"原系统日志导入完成：项目「{result.get('project_name', '')}」，"
                f"新增 {result['imported_count']} 条，更新 {result['updated_count']} 条"
            ),
            **result,
            "extra": extra,
        }
    )


@app.route("/api/admin/logs/export", methods=["GET"])
@admin_required
def api_admin_export_logs():
    try:
        year = int(request.args["year"]) if request.args.get("year") else None
        month = int(request.args["month"]) if request.args.get("month") else None
        day = int(request.args["day"]) if request.args.get("day") else None
        user_id = int(request.args["user_id"]) if request.args.get("user_id") else None
        project_id = int(request.args["project_id"]) if request.args.get("project_id") else None
    except ValueError:
        return jsonify({"error": "查询参数无效"}), 400

    user_name = request.args.get("user_name", "")
    project_name = request.args.get("project_name", "")
    has_project_filter = bool(project_id or project_name.strip())

    logs = query_work_logs(
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=user_name,
        project_id=project_id,
        project_name=project_name,
        approved_only=True,
    )
    attendance_rows = query_attendance_records(
        year=year,
        month=month,
        day=day,
        user_id=user_id,
        user_name=user_name,
    )
    logs = merge_admin_logs_with_attendance(
        logs,
        attendance_rows,
        include_attendance_only=not has_project_filter,
    )
    excel_bytes = export_query_logs_excel(logs)
    filename = f"日志查询_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return send_file(
        io.BytesIO(excel_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/api/admin/options/users", methods=["GET"])
@admin_required
def api_admin_user_options():
    return jsonify({"items": list_approved_users()})


@app.route("/api/admin/options/projects", methods=["GET"])
@admin_required
def api_admin_project_options():
    return jsonify({"items": list_projects(include_disabled=True)})


@app.route("/api/history", methods=["GET"])
@admin_required
def get_history_list():
    return jsonify({"items": list_history()})


@app.route("/api/history/<record_id>", methods=["GET"])
@admin_required
def get_history_detail(record_id: str):
    item = get_history(record_id)
    if item is None:
        return jsonify({"error": "记录不存在"}), 404

    token = item["token"]
    cache_records(token, item["output_filename"], item["sheet_name"], restore_records(item["records"]))

    return jsonify(
        {
            "id": item["id"],
            "token": token,
            "filename": item["output_filename"],
            "source_filename": item["source_filename"],
            "created_at": item["created_at"],
            "year": item["year"],
            "month": item["month"],
            "summary": item["summary"],
            "rows": item["rows"],
        }
    )


@app.route("/api/history/<record_id>", methods=["DELETE"])
@admin_required
def remove_history(record_id: str):
    if not delete_history(record_id):
        return jsonify({"error": "记录不存在"}), 404
    return jsonify({"message": "删除成功"})


@app.route("/api/convert", methods=["POST"])
@admin_required
def convert():
    cleanup_cache()

    upload = request.files.get("file")
    year_raw = request.form.get("year", "").strip()
    month_raw = request.form.get("month", "").strip()

    if upload is None or upload.filename == "":
        return jsonify({"error": "请上传日志 Excel 文件"}), 400

    original_filename = upload.filename
    filename = secure_filename(upload.filename)
    if not filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        return jsonify({"error": "仅支持 Excel 文件（.xlsx / .xlsm / .xls）"}), 400

    try:
        year = int(year_raw)
        month = int(month_raw)
    except ValueError:
        return jsonify({"error": "年份和月份必须是数字"}), 400

    if not 1 <= month <= 12:
        return jsonify({"error": "月份必须在 1-12 之间"}), 400

    file_bytes = upload.read()
    if not file_bytes:
        return jsonify({"error": "上传文件为空"}), 400

    try:
        result = build_convert_result(io.BytesIO(file_bytes), year, month, mapping=get_flat_project_mapping())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"解析失败: {exc}"}), 500

    token = result["token"]
    cache_records(token, result["filename"], result["sheet_name"], result["records"])

    history_item = save_history(
        source_filename=original_filename,
        year=year,
        month=month,
        output_filename=result["filename"],
        sheet_name=result["sheet_name"],
        token=token,
        summary=result["summary"],
        rows=result["rows"],
        records=result["records"],
    )

    return jsonify(
        {
            "token": token,
            "history_id": history_item["id"],
            "created_at": history_item["created_at"],
            "source_filename": original_filename,
            "filename": result["filename"],
            "year": year,
            "month": month,
            "summary": result["summary"],
            "rows": result["rows"],
        }
    )


@app.route("/api/download/<token>", methods=["GET"])
@login_required
def download(token: str):
    cleanup_cache()
    item = CACHE.get(token)
    if item is None:
        return jsonify({"error": "下载链接已失效，请重新打开历史记录或重新生成统计"}), 404

    excel_bytes = records_to_excel_bytes(item["records"], item["sheet_name"])
    return send_file(
        io.BytesIO(excel_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=item["filename"],
    )


def schedule_cache_cleanup() -> None:
    def worker() -> None:
        while True:
            time.sleep(600)
            cleanup_cache()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()


if __name__ == "__main__":
    schedule_cache_cleanup()
    app.run(host="0.0.0.0", port=5500, debug=True)
