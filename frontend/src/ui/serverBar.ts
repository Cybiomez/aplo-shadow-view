// Панель серверов (режим «Менеджер»): плоский список серверов локальной сети,
// добавляются вручную. Опрашивается только выбранное. Без кластеров.
import { api } from "../bridge";
import type { Registry, ServerLoad } from "../types";
import { icons } from "./icons";
import { openServerForm, serverLabel } from "./serverSettings";

interface Hooks {
  onSelectionChange(servers: string[]): void;
  onManageCredentials(): void;
  onRegistryChange(registry: Registry): void;
}

let host: HTMLElement;
let hooks: Hooks;
let registry: Registry = { clusters: [], servers: [], profiles: [], serverConfig: {} };
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

/** Все серверы — плоско (кластеры не используются в UI, но совместимость сохранена). */
function allServers(): string[] {
  const out: string[] = [...registry.servers];
  registry.clusters.forEach((c) => c.servers.forEach((s) => { if (!out.includes(s)) out.push(s); }));
  return out;
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
  const servers = allServers();
  const cardsHtml = servers.length
    ? servers.map((srv) => {
        const on = selected.has(srv) ? " on" : "";
        return `<div class="sb-card${on}">
          <label class="sb-pick"><input type="checkbox" data-server="${enc(srv)}" ${selected.has(srv) ? "checked" : ""}/>
            <span class="sb-srv-name">${serverLabel(srv, registry)}</span></label>
          ${loadBadge(srv)}
          <button class="sb-cfg" data-cfg="${enc(srv)}" title="Данные и настройки сервера">${icons.gear}</button>
          <button class="sb-del" data-del="${enc(srv)}" title="Убрать сервер">${icons.close}</button>
        </div>`;
      }).join("") + `<button class="sb-mini" data-all>Выбрать все</button><button class="sb-mini" data-none>Снять</button>`
    : '<span class="sb-hint">Серверов нет. Добавьте сервер локальной сети кнопкой «Сервер».</span>';

  host.innerHTML = `
    <div class="sb-top">
      <div class="sb-title">Серверы локальной сети</div>
      <div class="grow"></div>
      <div class="sb-manage-btns">
        <button class="sb-mbtn" data-add-server>${icons.serverPlus}<span>Сервер</span></button>
        <button class="sb-mbtn" data-creds>${icons.lock}<span>Учётные записи</span></button>
      </div>
    </div>
    <div class="sb-servers">${cardsHtml}</div>`;

  host.querySelector("[data-add-server]")?.addEventListener("click", async () => {
    const reg = await openServerForm(registry, null);
    if (reg) propagate(reg);
  });
  host.querySelector("[data-creds]")?.addEventListener("click", () => hooks.onManageCredentials());

  host.querySelectorAll<HTMLInputElement>("[data-server]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const srv = decodeURIComponent(cb.dataset.server!);
      if (cb.checked) selected.add(srv); else selected.delete(srv);
      render(); emit();
    }));
  host.querySelectorAll<HTMLElement>("[data-cfg]").forEach((b) =>
    b.addEventListener("click", async () => {
      const reg = await openServerForm(registry, decodeURIComponent(b.dataset.cfg!));
      if (reg) propagate(reg);
    }));
  host.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const srv = decodeURIComponent(b.dataset.del!);
      selected.delete(srv);
      propagate(await api.removeServer(srv, ""));
    }));
  host.querySelector("[data-all]")?.addEventListener("click", () => { allServers().forEach((s) => selected.add(s)); render(); emit(); });
  host.querySelector("[data-none]")?.addEventListener("click", () => { selected.clear(); render(); emit(); });
}
