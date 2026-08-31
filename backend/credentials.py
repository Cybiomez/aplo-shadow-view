"""
Учётные данные для подключения к серверам.

Пароли хранятся в Windows Credential Manager (DPAPI, привязка к текущему
пользователю Windows, без мастер-пароля). В JSON-реестре паролей нет — только
логины/домены. Экспорт реестра пароли не выносит.

Два уровня:
  - профиль учётки: домен + логин + пароль (пароль в Credential Manager по имени
    профиля). Назначается на серверы/кластеры;
  - применение к серверу: перед командами кладём креды в Credential Manager под
    ключи, которые подхватывают штатные средства —
      * net use / quser / реестр / tsdiscon / logoff → `cmdkey /add:<host>`;
      * теневой mstsc → `cmdkey /generic:TERMSRV/<host>`.

Windows-only; на других ОС — заглушки (для отладки вида и тестов логики).
"""

from __future__ import annotations

import subprocess
import sys

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_PROFILE_PREFIX = "AploShadowView/profile/"


# ---------- Credential Manager (пароли профилей) через ctypes ----------

def _cred_api():
    import ctypes
    from ctypes import wintypes

    advapi = ctypes.WinDLL("advapi32", use_last_error=True)

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_char)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    return ctypes, wintypes, advapi, CREDENTIAL


CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2


def write_profile(name: str, username: str, password: str) -> bool:
    """Сохранить пароль профиля в Credential Manager. username — для справки."""
    if sys.platform != "win32":
        return True
    ctypes, wintypes, advapi, CREDENTIAL = _cred_api()
    blob = password.encode("utf-16-le")
    cred = CREDENTIAL()
    cred.Flags = 0
    cred.Type = CRED_TYPE_GENERIC
    cred.TargetName = _PROFILE_PREFIX + name
    cred.CredentialBlobSize = len(blob)
    cred.CredentialBlob = ctypes.cast(ctypes.create_string_buffer(blob, len(blob)),
                                      ctypes.POINTER(ctypes.c_char))
    cred.Persist = CRED_PERSIST_LOCAL_MACHINE
    cred.UserName = username or name
    ok = advapi.CredWriteW(ctypes.byref(cred), 0)
    return bool(ok)


def read_profile(name: str) -> str | None:
    """Прочитать пароль профиля из Credential Manager."""
    if sys.platform != "win32":
        return None
    ctypes, wintypes, advapi, CREDENTIAL = _cred_api()
    ptr = ctypes.POINTER(CREDENTIAL)()
    ok = advapi.CredReadW(_PROFILE_PREFIX + name, CRED_TYPE_GENERIC, 0, ctypes.byref(ptr))
    if not ok:
        return None
    try:
        cred = ptr.contents
        size = cred.CredentialBlobSize
        if not size:
            return ""
        raw = ctypes.string_at(cred.CredentialBlob, size)
        return raw.decode("utf-16-le")
    finally:
        advapi.CredFree(ptr)


def delete_profile(name: str) -> None:
    if sys.platform != "win32":
        return
    ctypes, wintypes, advapi, CREDENTIAL = _cred_api()
    advapi.CredDeleteW(_PROFILE_PREFIX + name, CRED_TYPE_GENERIC, 0)


def has_profile(name: str) -> bool:
    return read_profile(name) is not None


# ---------- применение учётки к серверу (cmdkey) ----------

def apply_server(host: str, domain: str, username: str, password: str) -> None:
    r"""Установить сессию к серверу под нужной учётной записью.

    quser/tsdiscon/logoff ходят по RPC, а RPC НЕ читает Credential Manager — поэтому
    для чужой учётки нужна активная SMB-сессия (net use): RPC к тому же хосту
    переиспользует её контекст. cmdkey (TERMSRV) — отдельно для теневого mstsc.

    Формат логина: доменная — DOMAIN\user; локальная (домен пуст) — ХОСТ\user
    (локальный аккаунт живёт на самом сервере, не в домене)."""
    if sys.platform != "win32" or not host:
        return
    h = host.split(":", 1)[0]  # без порта — RPC/SMB по стандартным портам
    user = f"{domain}\\{username}" if domain else f"{h}\\{username}"
    # активная SMB-сессия для RPC (quser/реестр/tsdiscon/logoff)
    subprocess.run(["net", "use", f"\\\\{h}", f"/user:{user}", password],
                   capture_output=True, timeout=15, creationflags=_NO_WINDOW)
    # для теневого mstsc — через Credential Manager
    subprocess.run(["cmdkey", f"/generic:TERMSRV/{h}", f"/user:{user}", f"/pass:{password}"],
                   capture_output=True, timeout=10, creationflags=_NO_WINDOW)


def clear_server(host: str) -> None:
    if sys.platform != "win32" or not host:
        return
    h = host.split(":", 1)[0]
    subprocess.run(["net", "use", f"\\\\{h}", "/delete", "/y"], capture_output=True, timeout=15, creationflags=_NO_WINDOW)
    subprocess.run(["cmdkey", f"/delete:TERMSRV/{h}"], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
