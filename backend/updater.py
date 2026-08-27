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
import subprocess
import sys
import tempfile
import urllib.request
import webbrowser

from .version import GITHUB_REPO, VERSION

_API_RELEASES = f"https://api.github.com/repos/{GITHUB_REPO}/releases"
_TAG_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$")
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

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
    with urllib.request.urlopen(req, timeout=10) as resp:
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

    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".download")
        with urllib.request.urlopen(url, timeout=60) as resp:
            tmp.write(resp.read())
        tmp.close()
    except Exception as e:
        return {"ok": False, "message": f"Не удалось скачать: {e}"}

    target = sys.executable  # для onefile-сборки это и есть наш exe
    try:
        if sys.platform == "win32":
            _swap_windows(tmp.name, target)
        else:
            _swap_posix(tmp.name, target)
    except Exception as e:
        return {"ok": False, "message": f"Не удалось установить: {e}"}
    return {"ok": True, "message": f"Обновление v{info['version']} установлено — перезапуск"}


def _swap_windows(new_file: str, target: str) -> None:
    # Помощник ждёт выхода приложения (по PID), подменяет exe и перезапускает.
    pid = os.getpid()
    helper = tempfile.NamedTemporaryFile(delete=False, suffix=".cmd", mode="w", encoding="cp866")
    helper.write(
        "@echo off\r\n"
        f":wait\r\n"
        f"tasklist /FI \"PID eq {pid}\" | find \"{pid}\" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)\r\n"
        f"move /Y \"{new_file}\" \"{target}\" >nul\r\n"
        f"start \"\" \"{target}\"\r\n"
        f"del \"%~f0\"\r\n"
    )
    helper.close()
    subprocess.Popen(["cmd", "/c", helper.name], creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
    # приложение сейчас завершится — помощник дождётся и заменит файл
    os._exit(0)


def _swap_posix(new_file: str, target: str) -> None:
    os.replace(new_file, target)
    os.chmod(target, 0o755)
    os.execv(target, [target])
