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

from . import actions, credentials, policy, resources, updater
from .servers import ServerRegistry
from .config import Config
from .sessions import list_sessions, probe
from .version import VERSION


class Api:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._registry = ServerRegistry()
        self._window = None

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

    def _apply_creds(self, host: str) -> None:
        """Положить учётку сервера в Credential Manager перед командами.
        local — снять явные креды (работаем под текущей учёткой)."""
        auth = self._registry.resolve_auth(host)
        mode = auth.get("mode", "local")
        if mode == "local":
            credentials.clear_server(host)
            return
        if mode == "profile":
            domain, username = self._registry.profile_login(auth.get("profile", ""))
            pw = credentials.read_profile(auth.get("profile", "")) or ""
        else:  # explicit
            domain, username = auth.get("domain", ""), auth.get("username", "")
            pw = credentials.read_profile("server:" + host) or ""
        if username:
            credentials.apply_server(host, domain, username, pw)

    def _zabbix_for(self, host: str):
        url = self._registry.resolve_zabbix(host)
        token = credentials.read_profile("zabbix:" + host) or ""
        if not url:
            url, token = self._config.zabbix  # глобальный запасной
        return url, token

    def poll_servers(self, servers: list) -> list:
        """Параллельный опрос ТОЛЬКО переданных серверов (то, что открыто по фильтрам).
        Возвращает список {server, ok, sessions, error, load?}. Один зависший не
        вешает остальных — у каждого свой таймаут. Если включены ресурсы —
        добавляет загрузку сервера и ЦПУ/ОЗУ по сеансам (тяжелее)."""
        names = [s for s in (servers or []) if s]
        if not names:
            return []
        show = self._config.show_resources

        def enrich(server: str) -> dict:
            self._apply_creds(server)
            p = probe(server)
            if show and p.get("ok"):
                z_url, z_tok = self._zabbix_for(server)
                p["load"] = resources.server_load(server, z_url, z_tok)
                res = resources.session_resources(server)
                for sess in p.get("sessions", []):
                    r = res.get(str(sess["sid"]))
                    if r:
                        sess["ram_mb"] = r.get("ram_mb")
                        sess["cpu_pct"] = r.get("cpu_pct")
            return p

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(8, len(names))) as ex:
            return list(ex.map(enrich, names))

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

    # --- профили учётных записей и привязка ---
    def set_profile(self, name: str, domain: str, username: str, password: str, kind: str = "domain") -> dict:
        self._registry.set_profile(name, domain, username, kind)
        if password:
            credentials.write_profile(name, username, password)
        return self._registry.as_dict()

    def remove_profile(self, name: str) -> dict:
        self._registry.remove_profile(name)
        credentials.delete_profile(name)
        return self._registry.as_dict()

    def set_server_auth(self, host: str, auth: dict, password: str = "") -> dict:
        self._registry.set_server_auth(host, auth)
        if auth.get("mode") == "explicit" and password:
            credentials.write_profile("server:" + host, auth.get("username", ""), password)
        return self._registry.as_dict()

    def set_cluster_profile(self, name: str, profile: str) -> dict:
        self._registry.set_cluster_defaults(name, profile=profile)
        return self._registry.as_dict()

    def set_server_display(self, host: str, display_name: str, show_ip: bool) -> dict:
        self._registry.set_server_display(host, display_name, show_ip)
        return self._registry.as_dict()

    def set_server_zabbix(self, host: str, url: str, token: str) -> dict:
        self._registry.set_server_zabbix(host, url, bool(url and token))
        if token:
            credentials.write_profile("zabbix:" + host, "", token)
        return self._registry.as_dict()

    def set_cluster_zabbix(self, name: str, url: str) -> dict:
        self._registry.set_cluster_defaults(name, zabbix_url=url)
        return self._registry.as_dict()

    def test_server(self, host: str) -> dict:
        """Применить креды и проверить доступность (quser). {ok, error}."""
        self._apply_creds(host)
        from .sessions import probe
        p = probe(host)
        return {"ok": p["ok"], "error": p.get("error", "")}

    # --- настройки ---
    def get_settings(self) -> dict:
        return self._config.as_dict()

    def set_mode(self, mode: str) -> None:
        self._config.mode = mode

    def set_channel(self, channel: str) -> None:
        self._config.channel = channel

    def set_policy_minutes(self, minutes: int) -> None:
        self._config.policy_minutes = int(minutes)

    def set_show_resources(self, value: bool) -> None:
        self._config.show_resources = bool(value)

    def set_zabbix(self, url: str, token: str) -> None:
        self._config.set_zabbix(url, token)

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

    def set_window(self, window) -> None:
        self._window = window

    def apply_update(self) -> dict:
        res = updater.apply(self._config.channel)
        if res.get("ok"):
            # закрыть приложение штатно, чтобы освободить exe для замены;
            # os._exit — страховка, если destroy не завершит процесс
            import threading
            threading.Timer(0.8, self._exit_app).start()
        return res

    def _exit_app(self) -> None:
        import os
        try:
            if self._window is not None:
                self._window.destroy()
        except Exception:
            pass
        import threading
        threading.Timer(2.5, lambda: os._exit(0)).start()
