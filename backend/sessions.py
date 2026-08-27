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


def list_sessions() -> list[dict]:
    if sys.platform != "win32":
        # Заглушка для отладки вида на не-Windows.
        return [
            {"name": "admin", "sid": 1, "state": "active", "idle": "нет", "you": True},
            {"name": "i.ivanov", "sid": 3, "state": "active", "idle": "2 мин", "you": False},
            {"name": "p.petrov", "sid": 4, "state": "active", "idle": "6 мин", "you": False},
            {"name": "a.kozlov", "sid": 2, "state": "disc", "idle": "—", "you": False},
        ]
    try:
        raw = subprocess.run(
            ["quser"], capture_output=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        me = getpass.getuser()
    except Exception:
        me = ""
    return _parse(_decode(raw), me)
