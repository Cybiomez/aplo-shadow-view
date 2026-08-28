"""
Реестр серверов и кластеров (v2, удалённый режим).

Хранится отдельным файлом registry.json в папке приложения — открытый JSON,
можно шарить и править руками. Секретов в нём нет (только имена серверов).

Структура:
  {
    "clusters": [ {"name": "Терминалы Москва", "servers": ["TS-01","TS-02"]} ],
    "servers":  ["STANDALONE-01"]   # серверы вне кластеров
  }

Импорт/экспорт (обмен с коллегами) — целого кластера, одного сервера или всего
реестра. Импорт сливается с текущим без потери своего (дубликаты по имени не
плодятся, конфликт имён кластеров → копия «(2)»).
"""

from __future__ import annotations

import json
from pathlib import Path

from .config import app_dir

FMT_CLUSTER = "aploshadowview/cluster"
FMT_SERVER = "aploshadowview/server"
FMT_REGISTRY = "aploshadowview/registry"
FMT_VERSION = 1


def _norm(name: str) -> str:
    return name.strip()


def _same(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


class ServerRegistry:
    def __init__(self) -> None:
        self._file: Path = app_dir() / "registry.json"
        self._data: dict = {"clusters": [], "servers": [], "profiles": [], "serverConfig": {}}
        self._load()

    # ---------- хранилище ----------

    def _load(self) -> None:
        try:
            raw = json.loads(self._file.read_text(encoding="utf-8"))
            self._data["clusters"] = raw.get("clusters", []) or []
            self._data["servers"] = raw.get("servers", []) or []
            self._data["profiles"] = raw.get("profiles", []) or []
            self._data["serverConfig"] = raw.get("serverConfig", {}) or {}
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        self._file.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def as_dict(self) -> dict:
        return {
            "clusters": [dict(c) for c in self._data["clusters"]],
            "servers": list(self._data["servers"]),
            "profiles": [dict(p) for p in self._data.get("profiles", [])],
            "serverConfig": dict(self._data.get("serverConfig", {})),
        }

    # ---------- поиск ----------

    def _cluster(self, name: str) -> dict | None:
        for c in self._data["clusters"]:
            if _same(c["name"], name):
                return c
        return None

    def all_servers(self) -> list[str]:
        """Все известные серверы (в кластерах и вне) — уникально."""
        seen: list[str] = []
        for c in self._data["clusters"]:
            for s in c.get("servers", []):
                if not any(_same(s, x) for x in seen):
                    seen.append(s)
        for s in self._data["servers"]:
            if not any(_same(s, x) for x in seen):
                seen.append(s)
        return seen

    # ---------- кластеры ----------

    def add_cluster(self, name: str) -> None:
        name = _norm(name)
        if name and not self._cluster(name):
            self._data["clusters"].append({"name": name, "servers": []})
            self._save()

    def remove_cluster(self, name: str) -> None:
        c = self._cluster(name)
        if c:  # серверы не теряем — переносим в «Без кластера»
            for srv in c.get("servers", []):
                if not any(_same(srv, x) for x in self._data["servers"]):
                    self._data["servers"].append(srv)
        self._data["clusters"] = [x for x in self._data["clusters"] if not _same(x["name"], name)]
        self._save()

    def move_server(self, host: str, cluster: str = "") -> None:
        """Перенести сервер в кластер (пусто = «Без кластера»), без дублей."""
        host = _norm(host)
        self._data["servers"] = [s for s in self._data["servers"] if not _same(s, host)]
        for c in self._data["clusters"]:
            c["servers"] = [s for s in c["servers"] if not _same(s, host)]
        if cluster:
            tc = self._cluster(cluster)
            if tc is None:
                self.add_cluster(cluster); tc = self._cluster(cluster)
            if tc is not None and not any(_same(host, x) for x in tc["servers"]):
                tc["servers"].append(host)
        elif not any(_same(host, x) for x in self._data["servers"]):
            self._data["servers"].append(host)
        self._save()

    def rename_cluster(self, old: str, new: str) -> None:
        c = self._cluster(old)
        new = _norm(new)
        if c and new and not self._cluster(new):
            c["name"] = new
            self._save()

    # ---------- серверы ----------

    def add_server(self, name: str, cluster: str = "") -> None:
        name = _norm(name)
        if not name:
            return
        if cluster:
            c = self._cluster(cluster)
            if c is None:
                self.add_cluster(cluster)
                c = self._cluster(cluster)
            if c is not None and not any(_same(name, s) for s in c["servers"]):
                c["servers"].append(name)
        else:
            if not any(_same(name, s) for s in self._data["servers"]):
                self._data["servers"].append(name)
        self._save()

    def remove_server(self, name: str, cluster: str = "") -> None:
        if cluster:
            c = self._cluster(cluster)
            if c is not None:
                c["servers"] = [s for s in c["servers"] if not _same(s, name)]
        else:
            self._data["servers"] = [s for s in self._data["servers"] if not _same(s, name)]
        # 9) убрать конфигурацию удалённого сервера, чтобы не копилась
        for key in [k for k in self._data.get("serverConfig", {}) if _same(k, name)]:
            self._data["serverConfig"].pop(key, None)
        self._save()

    # ---------- профили учётных записей ----------

    def _profile(self, name: str) -> dict | None:
        for p in self._data.get("profiles", []):
            if _same(p.get("name", ""), name):
                return p
        return None

    def set_profile(self, name: str, domain: str, username: str, kind: str = "domain") -> None:
        name = _norm(name)
        if not name:
            return
        p = self._profile(name)
        data = {"name": name, "domain": domain.strip(), "username": username.strip(), "kind": kind}
        if p:
            p.update(data)
        else:
            self._data.setdefault("profiles", []).append(data)
        self._save()

    def remove_profile(self, name: str) -> None:
        self._data["profiles"] = [p for p in self._data.get("profiles", []) if not _same(p.get("name", ""), name)]
        # снять профиль с серверов, где он назначен
        for host, cfg in self._data.get("serverConfig", {}).items():
            auth = cfg.get("auth", {})
            if auth.get("mode") == "profile" and _same(auth.get("profile", ""), name):
                cfg["auth"] = {"mode": "local"}
        self._save()

    # ---------- конфигурация сервера (auth + zabbix) ----------

    def _server_cfg(self, host: str) -> dict:
        return self._data.setdefault("serverConfig", {}).setdefault(host, {})

    def set_server_auth(self, host: str, auth: dict) -> None:
        """auth: {mode: local|profile|explicit, profile?, domain?, username?}."""
        self._server_cfg(host)["auth"] = auth
        self._save()

    def set_server_display(self, host: str, display_name: str, show_ip: bool) -> None:
        cfg = self._server_cfg(host)
        cfg["displayName"] = display_name.strip()
        cfg["showIp"] = bool(show_ip)
        self._save()

    def set_server_zabbix(self, host: str, url: str, configured: bool) -> None:
        self._server_cfg(host)["zabbix"] = {"url": url.strip(), "configured": bool(configured)}
        self._save()

    def set_cluster_defaults(self, name: str, profile: str | None = None,
                             zabbix_url: str | None = None) -> None:
        c = self._cluster(name)
        if not c:
            return
        if profile is not None:
            c["profile"] = profile
        if zabbix_url is not None:
            c["zabbix"] = {"url": zabbix_url.strip()}
        self._save()

    def _cluster_of(self, host: str) -> dict | None:
        for c in self._data["clusters"]:
            if any(_same(host, srv) for srv in c.get("servers", [])):
                return c
        return None

    def resolve_auth(self, host: str) -> dict:
        """Итоговая учётка сервера: конфиг сервера → дефолт кластера → локально.
        Возвращает {mode, profile?, domain?, username?}."""
        cfg = self._data.get("serverConfig", {}).get(host, {})
        auth = cfg.get("auth")
        if auth and auth.get("mode"):
            return auth
        c = self._cluster_of(host)
        if c and c.get("profile"):
            return {"mode": "profile", "profile": c["profile"]}
        return {"mode": "local"}

    def resolve_zabbix(self, host: str) -> str:
        """URL Zabbix для сервера: свой → кластера → пусто."""
        cfg = self._data.get("serverConfig", {}).get(host, {})
        z = cfg.get("zabbix", {})
        if z.get("url"):
            return z["url"]
        c = self._cluster_of(host)
        if c and c.get("zabbix", {}).get("url"):
            return c["zabbix"]["url"]
        return ""

    def profile_login(self, name: str) -> tuple[str, str]:
        """(domain, username) профиля — для применения кредов."""
        p = self._profile(name)
        return (p.get("domain", ""), p.get("username", "")) if p else ("", "")

    # ---------- экспорт ----------

    def export_cluster(self, name: str) -> dict | None:
        c = self._cluster(name)
        if c is None:
            return None
        return {"type": FMT_CLUSTER, "version": FMT_VERSION, "cluster": dict(c)}

    def export_server(self, name: str) -> dict:
        cfg = dict(self._data.get("serverConfig", {}).get(name, {}))
        cfg.pop("authSaved", None)  # признак, не данные
        return {"type": FMT_SERVER, "version": FMT_VERSION, "server": _norm(name), "config": cfg}

    def export_all(self) -> dict:
        d = self.as_dict()
        # пароли не экспортируем (их и нет в JSON); профили — только логины/домены
        return {"type": FMT_REGISTRY, "version": FMT_VERSION, **d}

    # ---------- импорт (слияние без потерь) ----------

    def import_data(self, payload: dict) -> dict:
        """Влить кластер/сервер/реестр. Возвращает сводку {clusters, servers}."""
        added = {"clusters": 0, "servers": 0}
        kind = payload.get("type")

        if kind == FMT_SERVER:
            name = _norm(payload.get("server", ""))
            before = len(self.all_servers())
            self.add_server(name)
            added["servers"] += len(self.all_servers()) - before
            cfg = payload.get("config")
            if cfg and name:
                self._data.setdefault("serverConfig", {})[name] = dict(cfg)

        elif kind == FMT_CLUSTER:
            self._merge_cluster(payload.get("cluster", {}), added)

        elif kind == FMT_REGISTRY:
            for c in payload.get("clusters", []):
                self._merge_cluster(c, added)
            for s in payload.get("servers", []):
                before = len(self.all_servers())
                self.add_server(s)
                added["servers"] += len(self.all_servers()) - before
            for host, cfg in (payload.get("serverConfig") or {}).items():
                c = dict(cfg); c.pop("authSaved", None)
                self._data.setdefault("serverConfig", {}).setdefault(host, {}).update(c)
            for p in payload.get("profiles", []):
                if p.get("name") and not self._profile(p["name"]):
                    self._data.setdefault("profiles", []).append({
                        "name": p["name"], "domain": p.get("domain", ""),
                        "username": p.get("username", ""), "kind": p.get("kind", "domain")})
        else:
            raise ValueError("неизвестный формат импорта")

        self._save()
        return added

    def _merge_cluster(self, cluster: dict, added: dict) -> None:
        name = _norm(cluster.get("name", ""))
        servers = cluster.get("servers", []) or []
        if not name:
            return
        existing = self._cluster(name)
        if existing is None:
            # нет конфликта имени — создаём
            self._data["clusters"].append({"name": name, "servers": []})
            existing = self._cluster(name)
            added["clusters"] += 1
        # слить серверы без дублей
        for s in servers:
            if existing is not None and not any(_same(s, x) for x in existing["servers"]):
                existing["servers"].append(_norm(s))
                added["servers"] += 1
