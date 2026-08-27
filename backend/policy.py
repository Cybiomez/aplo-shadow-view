"""
Политика теневого доступа RDS.

Реестр (HKLM):
  ...\\Terminal Services\\Shadow
    1 — полный контроль С подтверждения пользователя (обычный режим);
    2 — полный контроль БЕЗ подтверждения (экстренный режим).

Экстренный режим включается временно. Возврат к «с подтверждением» гарантирует
ОДНОРАЗОВОЕ ЗАДАНИЕ ПЛАНИРОВЩИКА от SYSTEM: оно вернёт Shadow=1 через N минут,
даже если это приложение закрыто или зависло. Это ключевое требование —
«системный таймер, не зависящий от программы».

Смена значения Shadow не роняет уже поднятые теневые соединения: реестр читается
только при инициации нового сеанса.

Файл состояния (policy_state.json) — только для обратного отсчёта в интерфейсе;
настоящую гарантию даёт задание планировщика, а не он.
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


# ---------- состояние для UI ----------

def _read_state() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_state(active: bool, minutes: int) -> None:
    data = {"active": active, "minutes": minutes,
            "end_epoch": int(time.time()) + minutes * 60 if active else 0}
    _STATE_FILE.write_text(json.dumps(data), encoding="utf-8")


def _clear_state() -> None:
    try:
        _STATE_FILE.unlink()
    except FileNotFoundError:
        pass


# ---------- реестр ----------

def _get_shadow() -> int:
    if sys.platform != "win32":
        return SHADOW_NO_CONSENT if _read_state().get("active") else SHADOW_WITH_CONSENT
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _REG_PATH, 0, winreg.KEY_READ) as k:
            value, _ = winreg.QueryValueEx(k, _REG_VALUE)
            return int(value)
    except FileNotFoundError:
        return SHADOW_WITH_CONSENT  # значения нет — считаем обычный режим


def _set_shadow(value: int) -> None:
    if sys.platform != "win32":
        return
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, _REG_PATH, 0,
                            winreg.KEY_SET_VALUE | winreg.KEY_READ) as k:
        winreg.SetValueEx(k, _REG_VALUE, 0, winreg.REG_DWORD, value)


# ---------- задание планировщика (гарантия возврата) ----------

def _schedule_revert(minutes: int) -> None:
    """Создать одноразовое задание от SYSTEM: вернуть Shadow=1 через N минут."""
    if sys.platform != "win32":
        return
    reg_arg = (r'add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" '
               r'/v Shadow /t REG_DWORD /d 1 /f')
    ps = f"""
$ErrorActionPreference='Stop'
$name='{_TASK_NAME}'
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
$act=New-ScheduledTaskAction -Execute 'reg.exe' -Argument '{reg_arg}'
$trg=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes({minutes})
$trg.EndBoundary=((Get-Date).AddMinutes({minutes} + 60)).ToString('yyyy-MM-ddTHH:mm:ss')
$set=New-ScheduledTaskSettingsSet -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 10) -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
$prn=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $prn -Force | Out-Null
"""
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   capture_output=True, timeout=30, creationflags=_NO_WINDOW)


def _cancel_revert() -> None:
    if sys.platform != "win32":
        return
    ps = f"Unregister-ScheduledTask -TaskName '{_TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue"
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   capture_output=True, timeout=30, creationflags=_NO_WINDOW)


# ---------- публичное API ----------

def is_emergency_active() -> bool:
    return _get_shadow() == SHADOW_NO_CONSENT


def get_policy() -> dict:
    """Состояние для UI: active + сколько секунд до авто-возврата + minutes."""
    active = is_emergency_active()
    state = _read_state()
    minutes = int(state.get("minutes", 15))
    remaining = 0
    if active:
        end = int(state.get("end_epoch", 0))
        remaining = max(end - int(time.time()), 0) if end else minutes * 60
    return {"active": active, "remaining": remaining, "minutes": minutes}


def enable_emergency(minutes: int) -> dict:
    _set_shadow(SHADOW_NO_CONSENT)
    _schedule_revert(minutes)
    _write_state(True, minutes)
    audit.log("policy:emergency-on", "", "", f"{minutes}min")
    return get_policy()


def disable_emergency() -> dict:
    _set_shadow(SHADOW_WITH_CONSENT)
    _cancel_revert()
    _clear_state()
    audit.log("policy:emergency-off", "", "", "manual")
    return get_policy()
