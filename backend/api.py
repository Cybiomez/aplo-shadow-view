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
from .servers import ServerRegistry
from .config import Config
from .sessions import list_sessions, probe
from .version import VERSION


class Api:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._registry = ServerRegistry()

    # --- информация ---
    def get_server_name(self) -> str:
        try:
            return socket.gethostname().upper()
        except OSError:
            return "—"

    def get_version(self) -> str:
        return VERSION

    # --- сеансы ---
    def list_sessions(self, server: str = "") -> list[dict]:
        return list_sessions(server)

    def poll_servers(self, servers: list) -> list:
        """Параллельный опрос ТОЛЬКО переданных серверов (то, что открыто по фильтрам).
        Возвращает список {server, ok, sessions, error}. Один зависший не вешает
        остальных — у каждого свой таймаут (в probe)."""
        names = [s for s in (servers or []) if s]
        if not names:
            return []
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(8, len(names))) as ex:
            return list(ex.map(probe, names))

    def shadow(self, sid: int, mode: str, server: str = "") -> dict:
        return actions.shadow(int(sid), mode, server)

    def disconnect(self, sid: int, server: str = "") -> dict:
        return actions.disconnect(int(sid), server)

    def logoff(self, sid: int, server: str = "") -> dict:
        return actions.logoff(int(sid), server)

    # --- реестр серверов и кластеров ---
    def get_registry(self) -> dict:
        return self._registry.as_dict()

    def add_cluster(self, name: str) -> dict:
        self._registry.add_cluster(name); return self._registry.as_dict()

    def remove_cluster(self, name: str) -> dict:
        self._registry.remove_cluster(name); return self._registry.as_dict()

    def rename_cluster(self, old: str, new: str) -> dict:
        self._registry.rename_cluster(old, new); return self._registry.as_dict()

    def add_server(self, name: str, cluster: str = "") -> dict:
        self._registry.add_server(name, cluster); return self._registry.as_dict()

    def remove_server(self, name: str, cluster: str = "") -> dict:
        self._registry.remove_server(name, cluster); return self._registry.as_dict()

    def export_cluster(self, name: str) -> dict | None:
        return self._registry.export_cluster(name)

    def export_server(self, name: str) -> dict:
        return self._registry.export_server(name)

    def export_registry(self) -> dict:
        return self._registry.export_all()

    def import_registry(self, payload: dict) -> dict:
        added = self._registry.import_data(payload)
        return {"added": added, "registry": self._registry.as_dict()}

    # --- импорт/экспорт файлом (диалоги pywebview) ---
    def export_file(self, kind: str, name: str = "") -> dict:
        """kind: cluster | server | registry. Открывает диалог сохранения."""
        if kind == "cluster":
            payload = self._registry.export_cluster(name)
            suggested = f"{name}.asvcluster"
        elif kind == "server":
            payload = self._registry.export_server(name)
            suggested = f"{name}.asvserver"
        else:
            payload = self._registry.export_all()
            suggested = "aploshadowview-registry.json"
        if payload is None:
            return {"ok": False, "message": "Нечего экспортировать"}
        return self._save_dialog(payload, suggested)

    def import_file(self) -> dict | None:
        data = self._open_dialog()
        if data is None:
            return None
        try:
            added = self._registry.import_data(data)
        except ValueError as e:
            return {"error": str(e)}
        return {"added": added, "registry": self._registry.as_dict()}

    def _save_dialog(self, payload: dict, suggested: str) -> dict:
        try:
            import json as _json
            import webview
            win = webview.active_window()
            if win is None:
                return {"ok": False, "message": "Нет активного окна"}
            path = win.create_file_dialog(webview.SAVE_DIALOG, save_filename=suggested)
            if not path:
                return {"ok": False, "message": "Отменено"}
            target = path if isinstance(path, str) else path[0]
            with open(target, "w", encoding="utf-8") as fh:
                _json.dump(payload, fh, ensure_ascii=False, indent=2)
            return {"ok": True, "message": f"Сохранено: {target}"}
        except Exception as e:
            return {"ok": False, "message": f"Ошибка экспорта: {e}"}

    def _open_dialog(self) -> dict | None:
        try:
            import json as _json
            import webview
            win = webview.active_window()
            if win is None:
                return None
            paths = win.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
            if not paths:
                return None
            src = paths[0] if isinstance(paths, (list, tuple)) else paths
            with open(src, "r", encoding="utf-8") as fh:
                return _json.load(fh)
        except Exception:
            return None

    # --- настройки ---
    def get_settings(self) -> dict:
        return self._config.as_dict()

    def set_channel(self, channel: str) -> None:
        self._config.channel = channel

    def set_policy_minutes(self, minutes: int) -> None:
        self._config.policy_minutes = int(minutes)

    # --- политика (экстренный режим) ---
    def get_policy(self, server: str = "") -> dict:
        return policy.get_policy(server)

    def enable_emergency(self, server: str = "") -> dict:
        return policy.enable_emergency(self._config.policy_minutes, server)

    def disable_emergency(self, server: str = "") -> dict:
        return policy.disable_emergency(server)

    # --- журнал ---
    def open_log(self) -> None:
        from . import audit
        audit.open_log()

    # --- уведомление об обновлении ---
    def get_update_notification(self) -> dict:
        """Показывать ли уведомление об обновлении. Канал учитывается автоматически:
        latest — только стабильные новее; dev — любые новее (стабильные и dev).
        Скрытую пользователем версию не показываем, пока не выйдет ещё свежее."""
        from .updater import _is_newer, check
        info = check(self._config.channel)
        if not info.get("available"):
            return {"show": False}
        dismissed = self._config.dismissed_update
        show = (not dismissed) or _is_newer(info["version"], dismissed)
        return {
            "show": show,
            "version": info["version"],
            "current": info["current"],
            "channel": self._config.channel,
        }

    def dismiss_update(self, version: str) -> None:
        """«Не показывать» — скрыть до выхода более свежей версии."""
        self._config.dismissed_update = version

    # --- обновление ---
    def check_update(self) -> dict:
        info = updater.check(self._config.channel)
        info.pop("_release", None)  # внутреннее наружу не отдаём
        return info

    def apply_update(self) -> dict:
        return updater.apply(self._config.channel)
