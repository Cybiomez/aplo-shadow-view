"""
Журнал действий — контур безопасности. Пишем в файл: время (UTC), администратор,
действие, целевой пользователь, сеанс, результат. Значений паролей здесь нет и
быть не может — приложение их не знает.
"""

from __future__ import annotations

import getpass
import os
from datetime import datetime, timezone

from .config import app_dir


def _admin() -> str:
    # Кто выполняет действие. На Windows — доменное имя из окружения, если есть.
    domain = os.environ.get("USERDOMAIN", "")
    try:
        user = getpass.getuser()
    except Exception:
        user = os.environ.get("USERNAME", "unknown")
    return f"{domain}\\{user}" if domain else user


def log(action: str, target: str = "", sid: str | int = "", result: str = "ok") -> None:
    line = "\t".join([
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        _admin(),
        action,
        str(target),
        str(sid),
        result,
    ])
    try:
        with (app_dir() / "audit.log").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass  # журнал не должен ронять действие
