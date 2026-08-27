"""
Действия над сеансами RDS: теневое подключение, отключение, выход.

Работают локально (server пустой) и удалённо — все команды нативно принимают
адрес сервера, Invoke-Command не нужен:
  quser /server:ИМЯ · mstsc /v:ИМЯ /shadow:ID · tsdiscon ID /server:ИМЯ ·
  logoff ID /server:ИМЯ

Windows-only; на других ОС — заглушка (для отладки вида). Каждое действие пишется
в журнал (audit) с указанием сервера.

Теневое подключение: /noConsentPrompt добавляется ТОЛЬКО когда активен экстренный
режим (реестр Shadow=2). Иначе пользователь подтверждает подключение на экране.
"""

from __future__ import annotations

import subprocess
import sys

from . import audit, policy

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _result(ok: bool, message: str) -> dict:
    return {"ok": ok, "message": message}


def _name_for(sid: int, server: str) -> str:
    from .sessions import list_sessions
    for s in list_sessions(server):
        if s["sid"] == sid:
            return s["name"]
    return f"сеанс {sid}"


def _at(server: str) -> str:
    return f" на {server}" if server else ""


def shadow(sid: int, mode: str, server: str = "") -> dict:
    """mode: 'view' | 'control'. Запускает mstsc, не дожидаясь закрытия окна."""
    who = _name_for(sid, server)
    if sys.platform != "win32":
        audit.log(f"shadow:{mode}", who, sid, f"stub{('@' + server) if server else ''}")
        return _result(True, f"(демо) Теневое подключение к {who}{_at(server)} — {mode}")

    args = ["mstsc"]
    if server:
        args.append(f"/v:{server}")
    args.append(f"/shadow:{sid}")
    if mode == "control":
        args.append("/control")
    if policy.is_emergency_active(server):
        args.append("/noConsentPrompt")

    try:
        subprocess.Popen(args, creationflags=_NO_WINDOW)
    except OSError as e:
        audit.log(f"shadow:{mode}", f"{who}{_at(server)}", sid, f"error:{e}")
        return _result(False, f"Не удалось запустить подключение: {e}")

    audit.log(f"shadow:{mode}", f"{who}{_at(server)}", sid, "ok")
    hint = "" if policy.is_emergency_active(server) else " Пользователь увидит запрос на подтверждение."
    verb = "просмотр" if mode == "view" else "управление"
    return _result(True, f"Подключение к {who}{_at(server)} ({verb}) запущено.{hint}")


def disconnect(sid: int, server: str = "") -> dict:
    who = _name_for(sid, server)
    if sys.platform != "win32":
        audit.log("disconnect", f"{who}{_at(server)}", sid, "stub")
        return _result(True, f"(демо) Сеанс {who}{_at(server)} отключён")
    cmd = ["tsdiscon", str(sid)]
    if server:
        cmd.append(f"/server:{server}")
    try:
        subprocess.run(cmd, capture_output=True, timeout=10, creationflags=_NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        audit.log("disconnect", f"{who}{_at(server)}", sid, f"error:{e}")
        return _result(False, f"Не удалось отключить сеанс: {e}")
    audit.log("disconnect", f"{who}{_at(server)}", sid, "ok")
    return _result(True, f"Сеанс пользователя {who}{_at(server)} отключён")


def logoff(sid: int, server: str = "") -> dict:
    who = _name_for(sid, server)
    if sys.platform != "win32":
        audit.log("logoff", f"{who}{_at(server)}", sid, "stub")
        return _result(True, f"(демо) Пользователь {who}{_at(server)} выведен из системы")
    cmd = ["logoff", str(sid)]
    if server:
        cmd.append(f"/server:{server}")
    try:
        subprocess.run(cmd, capture_output=True, timeout=10, creationflags=_NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        audit.log("logoff", f"{who}{_at(server)}", sid, f"error:{e}")
        return _result(False, f"Не удалось завершить сеанс: {e}")
    audit.log("logoff", f"{who}{_at(server)}", sid, "ok")
    return _result(True, f"Пользователь {who}{_at(server)} выведен из системы")
