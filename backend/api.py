"""
Мост UI ↔ Python (js_api для pywebview).

Экземпляр передаётся в окно как js_api: каждый метод виден из JavaScript как
window.pywebview.api.<имя>. Имена (snake_case) совпадают с вызовами в
frontend/src/bridge.ts. Класс тонкий — только переводит вызовы UI в модули
sessions/actions/policy/updater; логика там.
"""

from __future__ import annotations

import socket
import sys

from . import actions, policy, updater
from .config import Config
from .sessions import list_sessions
from .version import VERSION


class Api:
    def __init__(self, config: Config) -> None:
        self._config = config

    # --- информация ---
    def get_server_name(self) -> str:
        try:
            return socket.gethostname().upper()
        except OSError:
            return "—"

    def get_version(self) -> str:
        return VERSION

    # --- сеансы ---
    def list_sessions(self) -> list[dict]:
        return list_sessions()

    def shadow(self, sid: int, mode: str) -> dict:
        return actions.shadow(int(sid), mode)

    def disconnect(self, sid: int) -> dict:
        return actions.disconnect(int(sid))

    def logoff(self, sid: int) -> dict:
        return actions.logoff(int(sid))

    # --- настройки ---
    def get_settings(self) -> dict:
        return self._config.as_dict()

    def set_channel(self, channel: str) -> None:
        self._config.channel = channel

    def set_policy_minutes(self, minutes: int) -> None:
        self._config.policy_minutes = int(minutes)

    # --- политика (экстренный режим) ---
    def get_policy(self) -> dict:
        return policy.get_policy()

    def enable_emergency(self) -> dict:
        return policy.enable_emergency(self._config.policy_minutes)

    def disable_emergency(self) -> dict:
        return policy.disable_emergency()

    # --- обновление ---
    def check_update(self) -> dict:
        info = updater.check(self._config.channel)
        info.pop("_release", None)  # внутреннее наружу не отдаём
        return info

    def apply_update(self) -> dict:
        return updater.apply(self._config.channel)
