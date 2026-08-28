// Панель серверов: управление (кластеры, серверы, учётки) + выбор для просмотра.
// Опрашивается ТОЛЬКО выбранное. При входе ничего не выбрано → список пуст.
import { api } from "../bridge";
import type { Registry, ServerLoad } from "../types";
import { icons } from "./icons";
import { openClusterForm, openServerForm, serverLabel } from "./serverSettings";

interface Hooks {
  onSelectionChange(servers: string[]): void;
  onManageCredentials(): void;
  onRegistryChange(registry: Registry): void;
}

const STANDALONE = " standalone";

let host: HTMLElement;
let hooks: Hooks;
let registry: Registry = { clusters: [], servers: [], profiles: [], serverConfig: {} };
let activeCluster: string | null = null;
const selected = new Set<string>();
let loads: Record<string, ServerLoad> = {};

export function initServerBar(mount: HTMLElement, reg: Registry, h: Hooks): void {
  host = mount;
  hooks = h;
  registry = reg;
  render();
}

export function setRegistry(reg: Registry): void {
  registry = reg;
  const known = new Set(allServers());
  for (const s of [...selected]) if (!known.has(s)) selected.delete(s);
  render();
  emit();
}

export function selectedServers(): string[] { return [...selected]; }

export function setLoads(map: Record<string, ServerLoad>): void { loads = map || {}; render(); }

const enc = encodeURIComponent;

function allServers(): string[] {
  const out: string[] = [];
  registry.clusters.forEach((c) => c.servers.forEach((s) => out.push(s)));
  registry.servers.forEach((s) => out.push(s));
  return out;
}
function serversOf(key: string): string[] {
  if (key === STANDALONE) return registry.servers;
  return registry.clusters.find((c) => c.name === key)?.servers ?? [];
}
function emit(): void { hooks.onSelectionChange([...selected]); }
function propagate(reg: Registry): void { registry = reg; render(); emit(); hooks.onRegistryChange(reg); }

function loadBadge(server: string): string {
  const l = loads[server];
  if (!l || (l.cpu == null && l.ram_pct == null)) return "";
  const parts: string[] = [];
  if (l.cpu != null) parts.push(`ЦПУ ${l.cpu}%`);
  if (l.ram_pct != null) parts.push(`ОЗУ ${l.ram_pct}%`);
  const hot = (l.cpu ?? 0) >= 85 || (l.ram_pct ?? 0) >= 90 ? " hot" : "";
  return `<span class="sb-load${hot}">${parts.join(" · ")}</span>`;
}

function render(): void {
  const tabs = [
    ...registry.clusters.map((c) => ({ key: c.name, label: c.name })),
    ...(registry.servers.length ? [{ key: STANDALONE, label: "Без кластера" }] : []),
  ];

  const tabsHtml = tabs.map((t) => {
    const on = activeCluster === t.key ? " on" : "";
    const sel = serversOf(t.key).filter((s) => selected.has(s)).length;
    const badge = sel ? `<span class="sb-badge">${sel}</span>` : "";
    return `<button class="sb-tab${on}" data-cluster="${enc(t.key)}">${t.label}${badge}</button>`;
  }).join("");

  const emptyHint = tabs.length ? "" : '<span class="sb-empty-tabs">Серверов нет — добавьте кнопкой «Сервер»</span>';

  const servers = activeCluster ? serversOf(activeCluster) : [];
  const cardsHtml = activeCluster
    ? (servers.length
        ? servers.map((srv) => {
            const on = selected.has(srv) ? " on" : "";
            return `<div class="sb-card${on}">
              <label class="sb-pick"><input type="checkbox" data-server="${enc(srv)}" ${selected.has(srv) ? "checked" : ""}/>
                <span class="sb-srv-name">${serverLabel(srv, registry)}</span></label>
              ${loadBadge(srv)}
              <button class="sb-cfg" data-cfg="${enc(srv)}" title="Данные и настройки сервера">${icons.gear}</button>
              <button class="sb-del" data-del="${enc(srv)}" data-in="${enc(activeCluster === STANDALONE ? "" : activeCluster!)}" title="Убрать сервер">${icons.close}</button>
            </div>`;
          }).join("") +
          `<button class="sb-mini" data-all>Выбрать все</button><button class="sb-mini" data-none>Снять</button>`
        : '<span class="sb-hint">В кластере нет серверов — добавьте кнопкой «Сервер»</span>')
    : (tabs.length ? '<span class="sb-hint">Выберите кластер, затем серверы для просмотра</span>' : "");

  const canEditCluster = activeCluster && activeCluster !== STANDALONE;
  const clusterTools = canEditCluster
    ? `<div class="sb-cluster-tools"><button class="sb-mini" data-edit-cluster>Редактировать кластер</button><button class="sb-mini danger" data-del-cluster>Удалить кластер</button></div>`
    : "";
  host.innerHTML = `
    <div class="sb-top">
      <div class="sb-tabs">${tabsHtml}${emptyHint}</div>
      <div class="sb-manage-btns">
        <button class="sb-mbtn" data-add-cluster>${icons.folderPlus}<span>Кластер</span></button>
        <button class="sb-mbtn" data-add-server>${icons.serverPlus}<span>Сервер</span></button>
        <button class="sb-mbtn" data-creds>${icons.lock}<span>Учётные записи</span></button>
      </div>
    </div>
    ${clusterTools}
    <div class="sb-servers">${cardsHtml}</div>`;

  bindTop();
  bindCards();
}

function bindTop(): void {
  host.querySelectorAll<HTMLElement>("[data-cluster]").forEach((b) =>
    b.addEventListener("click", () => {
      const key = decodeURIComponent(b.dataset.cluster!);
      if (activeCluster === key) activeCluster = null;
      else { activeCluster = key; serversOf(key).forEach((s) => selected.add(s)); emit(); }
      render();
    }));
  host.querySelector("[data-add-cluster]")?.addEventListener("click", async () => {
    const reg = await openClusterForm(registry, null);
    if (reg) propagate(reg);
  });
  host.querySelector("[data-add-server]")?.addEventListener("click", async () => {
    const def = activeCluster && activeCluster !== STANDALONE ? activeCluster : "";
    const reg = await openServerForm(registry, null, def);
    if (reg) propagate(reg);
  });
  host.querySelector("[data-creds]")?.addEventListener("click", () => hooks.onManageCredentials());
  host.querySelector("[data-edit-cluster]")?.addEventListener("click", async () => {
    const reg = await openClusterForm(registry, activeCluster);
    if (reg) propagate(reg);
  });
  host.querySelector("[data-del-cluster]")?.addEventListener("click", async () => {
    const name = activeCluster!;
    activeCluster = null;
    propagate(await api.removeCluster(name)); // серверы сохранятся в «Без кластера»
  });
}

function bindCards(): void {
  host.querySelectorAll<HTMLInputElement>("[data-server]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const srv = decodeURIComponent(cb.dataset.server!);
      if (cb.checked) selected.add(srv); else selected.delete(srv);
      render(); emit();
    }));
  host.querySelectorAll<HTMLElement>("[data-cfg]").forEach((b) =>
    b.addEventListener("click", async () => {
      const srv = decodeURIComponent(b.dataset.cfg!);
      const reg = await openServerForm(registry, srv, "");
      if (reg) propagate(reg);
    }));
  host.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const srv = decodeURIComponent(b.dataset.del!);
      selected.delete(srv);
      propagate(await api.removeServer(srv, decodeURIComponent(b.dataset.in || "")));
    }));
  host.querySelector("[data-all]")?.addEventListener("click", () => { serversOf(activeCluster!).forEach((s) => selected.add(s)); render(); emit(); });
  host.querySelector("[data-none]")?.addEventListener("click", () => { serversOf(activeCluster!).forEach((s) => selected.delete(s)); render(); emit(); });
}

