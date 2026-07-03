"""认证装饰器与工具。"""

from __future__ import annotations

from functools import wraps
from typing import Callable

from flask import jsonify, redirect, request, session, url_for

from database import ROLE_ADMIN, USER_STATUS_APPROVED


def login_required(view: Callable):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = session.get("user")
        if not user:
            if request.path.startswith("/api/"):
                return jsonify({"error": "请先登录"}), 401
            return redirect(url_for("login_page"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view: Callable):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        user = session.get("user") or {}
        if user.get("role") != ROLE_ADMIN:
            if request.path.startswith("/api/"):
                return jsonify({"error": "需要管理员权限"}), 403
            return redirect(url_for("my_logs_page"))
        return view(*args, **kwargs)

    return wrapped


def approved_user_required(view: Callable):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        user = session.get("user") or {}
        if user.get("role") != ROLE_ADMIN and user.get("status") != USER_STATUS_APPROVED:
            if request.path.startswith("/api/"):
                return jsonify({"error": "账号尚未通过审核"}), 403
            return redirect(url_for("login_page"))
        return view(*args, **kwargs)

    return wrapped


def manager_required(view: Callable):
    @wraps(view)
    @approved_user_required
    def wrapped(*args, **kwargs):
        user = session.get("user") or {}
        if not user.get("is_project_manager"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "需要项目负责人权限"}), 403
            return redirect(url_for("my_logs_page"))
        return view(*args, **kwargs)

    return wrapped
