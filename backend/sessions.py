"""
Список пользователей в системе через `quser` (query user).

Разбор устойчив к:
  - русской локали (заголовки/состояния на русском);
  - отключённым сеансам, где пустое имя сеанса сдвигает колонки;
  - маркеру '>' у текущего сеанса.

Опора на числовой ID: имя — первый столбец, ID — первое целое в строке.
На не-Windows возвращаем учебный набор, чтобы отлаживать интерфейс.
"""

from __future__ import annotations

import getpass
import re
import subprocess
import sys

def _host_only(server: str) -> str:
    """Отбросить :порт — quser/RPC идут по стандартным портам, не по RDP-порту."""
    return server.split(':', 1)[0] if server else server


_ACTIVE_WORDS = ("active", "активно", "активн")


def _decode(raw: bytes) -> str:
    # quser печатает в OEM-кодировке консоли. Для русской Windows это cp866.
    for enc in ("cp866", "cp1251", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _parse(text: str, me: str) -> list[dict]:
    out: list[dict] = []
    lines = text.splitlines()
    for line in lines[1:]:  # первая строка — заголовок
        if not line.strip():
            continue
        stripped = line.lstrip(">").strip()
        # схлопываем прогоны из 2+ пробелов в разделитель '|'
        parts = re.sub(r"\s{2,}", "|", stripped).strip("|").split("|")
        if len(parts) < 2:
            continue
        # отключённый сеанс: имя сеанса пустое → ID на второй позиции
        if parts[1].isdigit():
            name, sid, state = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
            idle = parts[3] if len(parts) > 3 else "—"
        else:
            if len(parts) < 3 or not parts[2].isdigit():
                continue
            name, sid, state = parts[0], parts[2], parts[3] if len(parts) > 3 else ""
            idle = parts[4] if len(parts) > 4 else "—"

        is_active = any(w in state.lower() for w in _ACTIVE_WORDS)
        out.append({
            "name": name,
            "sid": int(sid),
            "state": "active" if is_active else "disc",
            "idle": idle if idle else "—",
            "you": name.lower() == me.lower(),
        })
    return out


def list_sessions(server: str = "") -> list[dict]:
    """Сеансы локального сервера (server пустой) или удалённого (quser /server:ИМЯ)."""
    if sys.platform != "win32":
        # Заглушка для отладки вида на не-Windows.
        tag = f"@{server}" if server else ""
        return [
            {"name": f"admin{tag}", "sid": 1, "state": "active", "idle": "нет", "you": not server},
            {"name": f"i.ivanov{tag}", "sid": 3, "state": "active", "idle": "2 мин", "you": False},
            {"name": f"p.petrov{tag}", "sid": 4, "state": "active", "idle": "6 мин", "you": False},
            {"name": f"a.kozlov{tag}", "sid": 2, "state": "disc", "idle": "—", "you": False},
        ]
    cmd = ["quser"]
    if server:
        cmd.append(f"/server:{_host_only(server)}")
    try:
        raw = subprocess.run(
            cmd, capture_output=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        me = getpass.getuser()
    except Exception:
        me = ""
    # «вы» имеет смысл только на локальном сервере
    return _parse(_decode(raw), me if not server else "")


def probe(server: str) -> dict:
    """Опрос одного сервера с различением «пусто» и «недоступен».
    Возвращает {server, ok, sessions, error}."""
    if sys.platform != "win32":
        return {"server": server, "ok": True, "sessions": list_sessions(server), "error": ""}
    cmd = ["quser"]
    if server:
        cmd.append(f"/server:{_host_only(server)}")
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        return {"server": server, "ok": False, "sessions": [], "error": "таймаут"}
    except OSError as e:
        return {"server": server, "ok": False, "sessions": [], "error": str(e)}
    # quser возвращает код 1 и текст в stderr, если нет сеансов ИЛИ сервер недоступен
    if proc.returncode != 0 and not proc.stdout.strip():
        err = _decode(proc.stderr).strip().lower()
        # «No User exists» / «Пользователи не найдены» — это пусто, а не ошибка
        if "no user" in err or "не найден" in err or "нет польз" in err:
            return {"server": server, "ok": True, "sessions": [], "error": ""}
        return {"server": server, "ok": False, "sessions": [], "error": _decode(proc.stderr).strip() or "недоступен"}
    try:
        me = getpass.getuser()
    except Exception:
        me = ""
    return {"server": server, "ok": True,
            "sessions": _parse(_decode(proc.stdout), me if not server else ""), "error": ""}
