"""
Локальные настройки и состояние. Хранятся в папке приложения:
  Windows: %APPDATA%\\AploShadowView\\
  прочее:  ~/.config/aplo-shadow-view/

Настройки: канал обновлений, таймер экстренного режима.
Состояние политики: до какого времени активен экстренный режим (для отсчёта в UI;
настоящую гарантию возврата даёт задание планировщика, не этот файл).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

APP_DIR_NAME = "AploShadowView"

DEFAULTS = {
    "channel": "latest",     # latest | dev
    "policyMinutes": 15,     # 5 | 15 | 30
}


def app_dir() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        path = Path(base) / APP_DIR_NAME
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
        path = Path(base) / "aplo-shadow-view"
    path.mkdir(parents=True, exist_ok=True)
    return path


class Config:
    def __init__(self) -> None:
        self._file = app_dir() / "settings.json"
        self._data = dict(DEFAULTS)
        self._load()

    def _load(self) -> None:
        try:
            self._data.update(json.loads(self._file.read_text(encoding="utf-8")))
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        self._file.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")

    @property
    def channel(self) -> str:
        return self._data.get("channel", "latest")

    @channel.setter
    def channel(self, value: str) -> None:
        if value in ("latest", "dev"):
            self._data["channel"] = value
            self._save()

    @property
    def policy_minutes(self) -> int:
        return int(self._data.get("policyMinutes", 15))

    @policy_minutes.setter
    def policy_minutes(self, value: int) -> None:
        if value in (5, 15, 30):
            self._data["policyMinutes"] = value
            self._save()

    # --- какую версию обновления пользователь скрыл («не показывать») ---
    @property
    def dismissed_update(self) -> str:
        return self._data.get("dismissedUpdate", "")

    @dismissed_update.setter
    def dismissed_update(self, version: str) -> None:
        self._data["dismissedUpdate"] = version
        self._save()

    # --- геометрия окна (чтобы вставало как оставили) ---
    @property
    def window_state(self) -> dict:
        return dict(self._data.get("window", {}))

    def update_window(self, **kw) -> None:
        win = self._data.setdefault("window", {})
        changed = False
        for key, value in kw.items():
            if value is None:
                continue
            if win.get(key) != value:
                win[key] = value
                changed = True
        if changed:
            self._save()

    def as_dict(self) -> dict:
        return {"channel": self.channel, "policyMinutes": self.policy_minutes}
