"""登录验证码生成与校验。"""

from __future__ import annotations

import random
import string
import time
from typing import Any

CAPTCHA_TTL_SECONDS = 300
CAPTCHA_LENGTH = 4
CAPTCHA_CHARS = "".join(ch for ch in (string.ascii_uppercase + string.digits) if ch not in "0O1IL")


def generate_captcha_code(length: int = CAPTCHA_LENGTH) -> str:
    return "".join(random.choices(CAPTCHA_CHARS, k=length))


def store_captcha(session: dict[str, Any], code: str) -> None:
    session["captcha"] = {
        "code": code.upper(),
        "expires_at": time.time() + CAPTCHA_TTL_SECONDS,
    }


def clear_captcha(session: dict[str, Any]) -> None:
    session.pop("captcha", None)


def verify_captcha(session: dict[str, Any], user_input: str) -> bool:
    payload = session.get("captcha") or {}
    code = str(payload.get("code", "")).strip().upper()
    expires_at = float(payload.get("expires_at", 0))
    if not code or time.time() > expires_at:
        return False
    return user_input.strip().upper() == code


def build_captcha_svg(code: str) -> str:
    width, height = 132, 46
    lines = []
    for _ in range(5):
        x1, y1 = random.randint(0, width), random.randint(0, height)
        x2, y2 = random.randint(0, width), random.randint(0, height)
        color = random.choice(["#35d7ff", "#8b5cf6", "#ff4ecd", "#ffb020"])
        lines.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-opacity="0.35" stroke-width="1.2"/>'
        )

    chars = []
    slot_width = width / (len(code) + 1)
    for index, char in enumerate(code):
        x = slot_width * (index + 1)
        y = height / 2 + random.randint(-4, 6)
        rotate = random.randint(-18, 18)
        color = random.choice(["#e8f0ff", "#35d7ff", "#c4d8ff", "#9db0d0"])
        chars.append(
            f'<text x="{x:.1f}" y="{y:.1f}" fill="{color}" font-size="24" '
            f'font-family="Orbitron, monospace" font-weight="700" text-anchor="middle" '
            f'transform="rotate({rotate} {x:.1f} {y:.1f})">{char}</text>'
        )

    dots = []
    for _ in range(18):
        cx, cy = random.randint(0, width), random.randint(0, height)
        dots.append(f'<circle cx="{cx}" cy="{cy}" r="1.2" fill="#35d7ff" fill-opacity="0.25"/>')

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="验证码">
  <rect width="100%" height="100%" rx="12" fill="rgba(8, 14, 28, 0.92)" stroke="rgba(53, 215, 255, 0.28)" stroke-width="1"/>
  {''.join(lines)}
  {''.join(dots)}
  {''.join(chars)}
</svg>"""
