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
        self._data: dict = {"clusters": [], "servers": []}
        self._load()

    # ---------- хранилище ----------

    def _load(self) -> None:
        try:
            raw = json.loads(self._file.read_text(encoding="utf-8"))
            self._data["clusters"] = raw.get("clusters", []) or []
            self._data["servers"] = raw.get("servers", []) or []
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        self._file.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def as_dict(self) -> dict:
        return {"clusters": [dict(c) for c in self._data["clusters"]],
                "servers": list(self._data["servers"])}

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
        self._data["clusters"] = [c for c in self._data["clusters"] if not _same(c["name"], name)]
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
        self._save()

    # ---------- экспорт ----------

    def export_cluster(self, name: str) -> dict | None:
        c = self._cluster(name)
        if c is None:
            return None
        return {"type": FMT_CLUSTER, "version": FMT_VERSION, "cluster": dict(c)}

    def export_server(self, name: str) -> dict:
        return {"type": FMT_SERVER, "version": FMT_VERSION, "server": _norm(name)}

    def export_all(self) -> dict:
        d = self.as_dict()
        return {"type": FMT_REGISTRY, "version": FMT_VERSION, **d}

    # ---------- импорт (слияние без потерь) ----------

    def import_data(self, payload: dict) -> dict:
        """Влить кластер/сервер/реестр. Возвращает сводку {clusters, servers}."""
        added = {"clusters": 0, "servers": 0}
        kind = payload.get("type")

        if kind == FMT_SERVER:
            before = len(self.all_servers())
            self.add_server(payload.get("server", ""))
            added["servers"] += len(self.all_servers()) - before

        elif kind == FMT_CLUSTER:
            self._merge_cluster(payload.get("cluster", {}), added)

        elif kind == FMT_REGISTRY:
            for c in payload.get("clusters", []):
                self._merge_cluster(c, added)
            for s in payload.get("servers", []):
                before = len(self.all_servers())
                self.add_server(s)
                added["servers"] += len(self.all_servers()) - before
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
