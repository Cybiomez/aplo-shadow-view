// Управление реестром серверов и кластеров + импорт/экспорт файлом.
import { api } from "../bridge";
import type { Registry } from "../types";
import { icons } from "./icons";
import { toast } from "./toast";

interface Hooks {
  onChange(registry: Registry): void; // реестр изменился — обновить панель серверов
}

let overlay: HTMLElement;
let hooks: Hooks;
let registry: Registry = { clusters: [], servers: [] };

export async function initRegistryModal(h: Hooks): Promise<void> {
  hooks = h;
  registry = await api.getRegistry();

  overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="regTitle">
      <div class="m-head">
        <div class="m-ic accent" aria-hidden="true">${icons.logo}</div>
        <h2 id="regTitle">Серверы и кластеры</h2>
        <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button>
      </div>
      <div class="m-body">
        <div class="reg-toolbar">
          <button class="btn-line" data-add-cluster>Добавить кластер</button>
          <button class="btn-line" data-add-server>Добавить сервер</button>
          <div class="grow"></div>
          <button class="btn-line" data-import>Импорт</button>
          <button class="btn-line" data-export-all>Экспорт всего</button>
        </div>
        <div class="reg-list" data-reglist></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("[data-close]")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  overlay.querySelector("[data-add-cluster]")!.addEventListener("click", addCluster);
  overlay.querySelector("[data-add-server]")!.addEventListener("click", () => addServer(""));
  overlay.querySelector("[data-import]")!.addEventListener("click", doImport);
  overlay.querySelector("[data-export-all]")!.addEventListener("click", () => exportFile("registry", ""));

  renderList();
}

export function openRegistry(): void { overlay.classList.add("open"); renderList(); }
export function close(): void { overlay.classList.remove("open"); }

function apply(r: Registry): void {
  registry = r;
  renderList();
  hooks.onChange(r);
}

function renderList(): void {
  const box = overlay.querySelector<HTMLElement>("[data-reglist]")!;
  const clusterHtml = registry.clusters.map((c) => `
    <div class="reg-cluster">
      <div class="reg-cluster-head">
        <b>${c.name}</b>
        <span class="reg-count">${c.servers.length}</span>
        <div class="grow"></div>
        <button class="reg-mini" data-add-in="${encodeURIComponent(c.name)}" title="Добавить сервер">+ сервер</button>
        <button class="reg-mini" data-export-cluster="${encodeURIComponent(c.name)}" title="Экспортировать кластер">экспорт</button>
        <button class="reg-mini danger" data-del-cluster="${encodeURIComponent(c.name)}" title="Удалить кластер">${icons.close}</button>
      </div>
      <div class="reg-servers">
        ${c.servers.map((srv) => `
          <span class="reg-srv">
            ${srv}
            <button class="reg-x" data-del-server="${encodeURIComponent(srv)}" data-in="${encodeURIComponent(c.name)}" aria-label="Убрать">${icons.close}</button>
          </span>`).join("") || '<span class="reg-empty">пусто</span>'}
      </div>
    </div>`).join("");

  const standalone = registry.servers.length ? `
    <div class="reg-cluster">
      <div class="reg-cluster-head"><b>Без кластера</b><span class="reg-count">${registry.servers.length}</span></div>
      <div class="reg-servers">
        ${registry.servers.map((srv) => `
          <span class="reg-srv">${srv}
            <button class="reg-x" data-del-server="${encodeURIComponent(srv)}" data-in="" aria-label="Убрать">${icons.close}</button>
          </span>`).join("")}
      </div>
    </div>` : "";

  box.innerHTML = clusterHtml + standalone ||
    '<div class="reg-hint">Реестр пуст. Добавьте кластер или сервер, либо импортируйте из файла.</div>';

  box.querySelectorAll<HTMLElement>("[data-add-in]").forEach((b) =>
    b.addEventListener("click", () => addServer(decodeURIComponent(b.dataset.addIn!))));
  box.querySelectorAll<HTMLElement>("[data-del-cluster]").forEach((b) =>
    b.addEventListener("click", async () => apply(await api.removeCluster(decodeURIComponent(b.dataset.delCluster!)))));
  box.querySelectorAll<HTMLElement>("[data-export-cluster]").forEach((b) =>
    b.addEventListener("click", () => exportFile("cluster", decodeURIComponent(b.dataset.exportCluster!))));
  box.querySelectorAll<HTMLElement>("[data-del-server]").forEach((b) =>
    b.addEventListener("click", async () =>
      apply(await api.removeServer(decodeURIComponent(b.dataset.delServer!), decodeURIComponent(b.dataset.in || "")))));
}

async function addCluster(): Promise<void> {
  const name = prompt("Имя кластера:");
  if (name && name.trim()) apply(await api.addCluster(name.trim()));
}
async function addServer(cluster: string): Promise<void> {
  const label = cluster ? `Имя сервера (в кластер «${cluster}»):` : "Имя сервера (вне кластеров):";
  const name = prompt(label);
  if (name && name.trim()) apply(await api.addServer(name.trim(), cluster));
}
async function exportFile(kind: string, name: string): Promise<void> {
  const res = await api.exportFile(kind, name);
  toast(res.message, res.ok ? "ok" : "err");
}
async function doImport(): Promise<void> {
  const res = await api.importFile();
  if (res === null) return; // отменено
  if ("error" in res) { toast("Ошибка импорта: " + (res as { error: string }).error, "err"); return; }
  apply(res.registry);
  toast(`Импортировано: кластеров ${res.added.clusters}, серверов ${res.added.servers}`);
}
