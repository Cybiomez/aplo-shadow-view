"""
Действия над сеансами RDS: теневое подключение, отключение, выход.

Все вызовы Windows-only; на других ОС возвращаем заглушку (для отладки вида).
Каждое действие пишется в журнал (audit).

Теневое подключение:
  mstsc /shadow:<id> [/control]
  Флаг /noConsentPrompt добавляется ТОЛЬКО когда активен экстренный режим
  (реестр Shadow=2). Иначе пользователь подтверждает подключение на своём экране.
"""

from __future__ import annotations

import subprocess
import sys

from . import audit, policy

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _result(ok: bool, message: str) -> dict:
    return {"ok": ok, "message": message}


def _name_for(sid: int) -> str:
    from .sessions import list_sessions
    for s in list_sessions():
        if s["sid"] == sid:
            return s["name"]
    return f"сеанс {sid}"


def shadow(sid: int, mode: str) -> dict:
    """mode: 'view' | 'control'. Запускает mstsc, не дожидаясь закрытия окна."""
    who = _name_for(sid)
    if sys.platform != "win32":
        audit.log(f"shadow:{mode}", who, sid, "stub")
        return _result(True, f"(демо) Теневое подключение к {who} — {mode}")

    args = ["mstsc", f"/shadow:{sid}"]
    if mode == "control":
        args.append("/control")
    if policy.is_emergency_active():
        args.append("/noConsentPrompt")

    try:
        subprocess.Popen(args, creationflags=_NO_WINDOW)
    except OSError as e:
        audit.log(f"shadow:{mode}", who, sid, f"error:{e}")
        return _result(False, f"Не удалось запустить подключение: {e}")

    audit.log(f"shadow:{mode}", who, sid, "ok")
    hint = "" if policy.is_emergency_active() else " Пользователь увидит запрос на подтверждение."
    verb = "просмотр" if mode == "view" else "управление"
    return _result(True, f"Подключение к {who} ({verb}) запущено.{hint}")


def disconnect(sid: int) -> dict:
    who = _name_for(sid)
    if sys.platform != "win32":
        audit.log("disconnect", who, sid, "stub")
        return _result(True, f"(демо) Сеанс {who} отключён")
    try:
        subprocess.run(["tsdiscon", str(sid)], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        audit.log("disconnect", who, sid, f"error:{e}")
        return _result(False, f"Не удалось отключить сеанс: {e}")
    audit.log("disconnect", who, sid, "ok")
    return _result(True, f"Сеанс пользователя {who} отключён")


def logoff(sid: int) -> dict:
    who = _name_for(sid)
    if sys.platform != "win32":
        audit.log("logoff", who, sid, "stub")
        return _result(True, f"(демо) Пользователь {who} выведен из системы")
    try:
        subprocess.run(["logoff", str(sid)], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        audit.log("logoff", who, sid, f"error:{e}")
        return _result(False, f"Не удалось завершить сеанс: {e}")
    audit.log("logoff", who, sid, "ok")
    return _result(True, f"Пользователь {who} выведен из системы")
