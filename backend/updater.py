"""
Обновление из релизов GitHub (репозиторий публичный — токен не нужен).

Каналы:
  latest — только стабильные релизы (теги без суффикса, напр. v0.2.0);
  dev    — включая пред-релизы (v0.2.0-dev.1).

apply() скачивает бинарник под текущую ОС и заменяет им себя: запускает
вспомогательный сценарий, который ждёт выхода приложения, подменяет файл и
перезапускает. Если что-то не так — открывает страницу релизов, чтобы не
остаться без обновления.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import tempfile
import ssl
import urllib.request
import webbrowser

from .config import app_dir
from .version import GITHUB_REPO, VERSION

_API_RELEASES = f"https://api.github.com/repos/{GITHUB_REPO}/releases"
_TAG_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _ssl_context() -> "ssl.SSLContext":
    """SSL-контекст с корневыми сертификатами certifi. В собранном PyInstaller-exe
    системные CA недоступны → используем сертификаты certifi (иначе GitHub по HTTPS
    отбивается CERTIFICATE_VERIFY_FAILED)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

# Имена артефактов из CI (.github/workflows/build.yml).
_ASSET_BY_PLATFORM = {
    "win32": "AploShadowView-windows.exe",
    "linux": "AploShadowView-linux",
}


def _parse(tag: str):
    m = _TAG_RE.match(tag.strip())
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4) or "") if m else None


def _is_newer(candidate: str, current: str) -> bool:
    c, cur = _parse(candidate), _parse(current)
    if not c or not cur:
        return False
    if c[:3] != cur[:3]:
        return c[:3] > cur[:3]
    if c[3] == "" and cur[3] != "":
        return True   # стабильная новее своей же пред-релизной
    if c[3] != "" and cur[3] == "":
        return False
    return c[3] > cur[3]


def _fetch_releases() -> list[dict]:
    req = urllib.request.Request(_API_RELEASES, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=10, context=_ssl_context()) as resp:
        return json.load(resp)


def _pick(releases: list[dict], channel: str) -> dict | None:
    best, best_tag = None, VERSION
    for rel in releases:
        parsed = _parse(rel.get("tag_name", ""))
        if not parsed:
            continue
        if channel == "latest" and parsed[3] != "":  # стабильный канал без пред-релизов
            continue
        tag = rel["tag_name"].lstrip("v")
        if best is None or _is_newer(tag, best_tag):
            best, best_tag = rel, tag
    return best


def check(channel: str) -> dict:
    """Вернуть {available, version, current, error?}."""
    try:
        releases = _fetch_releases()
    except Exception as e:  # сеть/парсинг — не роняем UI
        return {"available": False, "version": VERSION, "current": VERSION, "error": str(e)}
    rel = _pick(releases, channel)
    if not rel:
        return {"available": False, "version": VERSION, "current": VERSION}
    tag = rel["tag_name"].lstrip("v")
    if _is_newer(tag, VERSION):
        return {"available": True, "version": tag, "current": VERSION, "_release": rel}
    return {"available": False, "version": VERSION, "current": VERSION}


def _asset_url(rel: dict) -> str | None:
    want = _ASSET_BY_PLATFORM.get(sys.platform)
    for a in rel.get("assets", []):
        if a.get("name") == want:
            return a.get("browser_download_url")
    return None


def apply(channel: str) -> dict:
    info = check(channel)
    if not info.get("available"):
        return {"ok": False, "message": "Обновлений нет"}
    rel = info.get("_release")
    url = _asset_url(rel) if rel else None
    if not url:
        webbrowser.open(rel.get("html_url", f"https://github.com/{GITHUB_REPO}/releases"))
        return {"ok": False, "message": "Нет сборки под эту ОС — открыта страница релизов"}

    target = os.path.abspath(sys.executable)  # для onefile — сам exe
    new_file = target + ".new"
    _ulog(f"apply: канал={channel} версия={info['version']} target={target}")

    try:
        with urllib.request.urlopen(url, timeout=120, context=_ssl_context()) as resp, open(new_file, "wb") as out:
            shutil.copyfileobj(resp, out)
    except Exception as e:
        _ulog(f"скачивание не удалось: {e}")
        return {"ok": False, "message": f"Не удалось скачать: {e}"}
    _ulog(f"скачано: {new_file} ({os.path.getsize(new_file)} байт)")

    try:
        if sys.platform == "win32":
            _swap_windows(new_file, target)
        else:
            _swap_posix(new_file, target)
    except Exception as e:
        _ulog(f"замена не удалась: {e}")
        return {"ok": False, "message": f"Не удалось установить: {e}"}
    return {"ok": True, "message": f"Обновление v{info['version']} загружено — приложение закроется и запустится заново"}


def _ulog(msg: str) -> None:
    """Пошаговый лог обновления — чтобы диагностировать на живой машине."""
    from datetime import datetime
    try:
        with (app_dir() / "update.log").open("a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
    except OSError:
        pass


def _swap_windows(new_file: str, target: str) -> None:
    """
    Помощник (без окна) ждёт ШТАТНОГО выхода приложения, затем подменяет exe и
    перезапускает. НЕ переименовываем работающий exe — это ломает проверку
    родительского процесса в PyInstaller onefile («failed to obtain executable
    path for parent process»). Файл освобождается, когда приложение закрылось
    через window.destroy() (см. api.apply_update).
    """
    pid = os.getpid()
    log = str(app_dir() / "update.log")
    bat_path = os.path.join(os.environ.get("TEMP", os.path.dirname(target)), "aplo-shadow-update.bat")
    script = (
        "@echo off\r\n"
        f'echo [%date% %time%] helper start pid={pid} >> "{log}"\r\n'
        ":wait\r\n"
        f'tasklist /FI "PID eq {pid}" 2>nul | find "{pid}" >nul\r\n'
        "if not errorlevel 1 ( ping -n 2 127.0.0.1 >nul & goto wait )\r\n"
        "set /a n=0\r\n"
        ":move\r\n"
        f'move /Y "{new_file}" "{target}" >> "{log}" 2>&1\r\n'
        "if errorlevel 1 (\r\n"
        "  set /a n+=1\r\n"
        "  if %n% lss 30 ( ping -n 2 127.0.0.1 >nul & goto move )\r\n"
        f'  echo [%date% %time%] MOVE FAILED >> "{log}"\r\n'
        "  goto done\r\n"
        ")\r\n"
        f'echo [%date% %time%] moved OK, restarting via explorer >> "{log}"\r\n'
        f'explorer.exe "{target}"\r\n'
        ":done\r\n"
        'del "%~f0"\r\n'
    )
    with open(bat_path, "w", encoding="cp866", errors="replace") as fh:
        fh.write(script)
    _ulog("помощник запущен (скрыто), ждёт штатного выхода приложения")
    flags = (getattr(subprocess, "CREATE_NO_WINDOW", 0)
             | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    subprocess.Popen(["cmd", "/c", bat_path], creationflags=flags, close_fds=True)
    # выход инициирует api.apply_update (window.destroy), не отсюда — чтобы онефайл
    # закрылся штатно и освободил exe для замены.


def _swap_posix(new_file: str, target: str) -> None:
    os.replace(new_file, target)
    os.chmod(target, 0o755)
    os.execv(target, [target])


def cleanup_leftovers() -> None:
    """Убрать остаток прошлого обновления (exe.old рядом) — вызывать при старте."""
    try:
        old = os.path.abspath(sys.executable) + ".old"
        if os.path.exists(old):
            os.remove(old)
    except OSError:
        pass
