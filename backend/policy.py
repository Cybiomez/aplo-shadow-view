"""
Политика теневого доступа RDS — локально и на удалённом сервере.

Реестр (HKLM ...\\Terminal Services\\Shadow):
  1 — с подтверждения пользователя (обычный); 2 — без подтверждения (экстренный).
Удалённый сервер — через winreg.ConnectRegistry(\\\\ИМЯ).

Экстренный режим временно ставит Shadow=2 и создаёт ОДНОРАЗОВОЕ ЗАДАНИЕ
ПЛАНИРОВЩИКА от SYSTEM (локально — PowerShell, удалённо — schtasks /s), которое
вернёт Shadow=1 через N минут — даже если приложение закрыто. Смена Shadow не
роняет уже поднятые теневые соединения (реестр читается при инициации сеанса).

Состояние для UI (обратный отсчёт) — в policy_state.json, по ключу сервера
("" = локальный). Настоящую гарантию даёт задание, а не файл.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

from . import audit
from .config import app_dir

_REG_PATH = r"SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services"
_REG_VALUE = "Shadow"
_TASK_NAME = "AploShadowView-PolicyRevert"
_STATE_FILE = app_dir() / "policy_state.json"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

SHADOW_WITH_CONSENT = 1
SHADOW_NO_CONSENT = 2


# ---------- состояние для UI (по серверу) ----------

def _read_all() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _read_state(server: str) -> dict:
    return _read_all().get(server or "", {})


def _write_state(server: str, active: bool, minutes: int) -> None:
    data = _read_all()
    data[server or ""] = {
        "active": active, "minutes": minutes,
        "end_epoch": int(time.time()) + minutes * 60 if active else 0,
    }
    _STATE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _clear_state(server: str) -> None:
    data = _read_all()
    data.pop(server or "", None)
    _STATE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


# ---------- реестр (локально/удалённо) ----------

def _get_shadow(server: str = "") -> int:
    if sys.platform != "win32":
        return SHADOW_NO_CONSENT if _read_state(server).get("active") else SHADOW_WITH_CONSENT
    import winreg
    try:
        root = winreg.ConnectRegistry(f"\\\\{server}" if server else None,
                                      winreg.HKEY_LOCAL_MACHINE)
        with winreg.OpenKey(root, _REG_PATH, 0, winreg.KEY_READ) as k:
            value, _ = winreg.QueryValueEx(k, _REG_VALUE)
            return int(value)
    except FileNotFoundError:
        return SHADOW_WITH_CONSENT
    except OSError:
        return SHADOW_WITH_CONSENT  # сервер недоступен — считаем обычный режим


def _set_shadow(server: str, value: int) -> None:
    if sys.platform != "win32":
        return
    import winreg
    root = winreg.ConnectRegistry(f"\\\\{server}" if server else None,
                                  winreg.HKEY_LOCAL_MACHINE)
    with winreg.CreateKeyEx(root, _REG_PATH, 0, winreg.KEY_SET_VALUE | winreg.KEY_READ) as k:
        winreg.SetValueEx(k, _REG_VALUE, 0, winreg.REG_DWORD, value)


# ---------- задание-возврат ----------

def _reg_revert_arg() -> str:
    return (r'add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" '
            r'/v Shadow /t REG_DWORD /d 1 /f')


def _schedule_revert(minutes: int, server: str) -> None:
    if sys.platform != "win32":
        return
    if server:
        # удалённо — schtasks /s (время в формате локали сервера; берём HH:MM + дата)
        when = time.localtime(time.time() + minutes * 60)
        st = time.strftime("%H:%M", when)
        sd = time.strftime("%m/%d/%Y", when)
        subprocess.run(
            ["schtasks", "/create", "/s", server, "/tn", _TASK_NAME, "/ru", "SYSTEM",
             "/sc", "once", "/st", st, "/sd", sd, "/rl", "HIGHEST", "/f",
             "/tr", "reg.exe " + _reg_revert_arg()],
            capture_output=True, timeout=30, creationflags=_NO_WINDOW)
        return
    # локально — PowerShell Register-ScheduledTask с авто-удалением
    ps = f"""
$ErrorActionPreference='Stop'
$name='{_TASK_NAME}'
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
$act=New-ScheduledTaskAction -Execute 'reg.exe' -Argument '{_reg_revert_arg()}'
$trg=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes({minutes})
$trg.EndBoundary=((Get-Date).AddMinutes({minutes} + 60)).ToString('yyyy-MM-ddTHH:mm:ss')
$set=New-ScheduledTaskSettingsSet -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
$prn=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $prn -Force | Out-Null
"""
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   capture_output=True, timeout=30, creationflags=_NO_WINDOW)


def _cancel_revert(server: str) -> None:
    if sys.platform != "win32":
        return
    if server:
        subprocess.run(["schtasks", "/delete", "/s", server, "/tn", _TASK_NAME, "/f"],
                       capture_output=True, timeout=30, creationflags=_NO_WINDOW)
        return
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                    f"Unregister-ScheduledTask -TaskName '{_TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue"],
                   capture_output=True, timeout=30, creationflags=_NO_WINDOW)


# ---------- публичное API ----------

def is_emergency_active(server: str = "") -> bool:
    return _get_shadow(server) == SHADOW_NO_CONSENT


def get_policy(server: str = "") -> dict:
    active = is_emergency_active(server)
    state = _read_state(server)
    minutes = int(state.get("minutes", 15))
    remaining = 0
    if active:
        end = int(state.get("end_epoch", 0))
        remaining = max(end - int(time.time()), 0) if end else minutes * 60
    return {"active": active, "remaining": remaining, "minutes": minutes, "server": server}


def enable_emergency(minutes: int, server: str = "") -> dict:
    _set_shadow(server, SHADOW_NO_CONSENT)
    _schedule_revert(minutes, server)
    _write_state(server, True, minutes)
    audit.log("policy:emergency-on", server, "", f"{minutes}min")
    return get_policy(server)


def disable_emergency(server: str = "") -> dict:
    _set_shadow(server, SHADOW_WITH_CONSENT)
    _cancel_revert(server)
    _clear_state(server)
    audit.log("policy:emergency-off", server, "", "manual")
    return get_policy(server)
