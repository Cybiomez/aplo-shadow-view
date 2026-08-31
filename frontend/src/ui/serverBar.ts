// Панель серверов (режим «Менеджер»): плоский список серверов локальной сети,
// добавляются вручную. Опрашивается только выбранное. Без кластеров.
import { api } from "../bridge";
import type { Registry } from "../types";
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
let dragSrv: string | null = null;

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
const enc = encodeURIComponent;

/** Все серверы — плоско (кластеры не используются в UI, но совместимость сохранена). */
function allServers(): string[] {
  const out: string[] = [...registry.servers];
  registry.clusters.forEach((c) => c.servers.forEach((s) => { if (!out.includes(s)) out.push(s); }));
  return out;
}
function emit(): void { hooks.onSelectionChange([...selected]); }
function propagate(reg: Registry): void { registry = reg; render(); emit(); hooks.onRegistryChange(reg); }

function render(): void {
  const servers = allServers();
  const cardsHtml = servers.length
    ? servers.map((srv) => {
        const on = selected.has(srv) ? " on" : "";
        return `<div class="sb-card${on}" draggable="true" data-card="${enc(srv)}" title="Перетащите, чтобы изменить порядок">
          <span class="sb-drag" aria-hidden="true">⋮⋮</span>
          <label class="sb-pick"><input type="checkbox" data-server="${enc(srv)}" ${selected.has(srv) ? "checked" : ""}/>
            <span class="sb-srv-name">${serverLabel(srv, registry)}</span></label>
          <button class="sb-cfg" data-cfg="${enc(srv)}" title="Данные и настройки сервера">${icons.gear}</button>
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
  host.querySelector("[data-all]")?.addEventListener("click", () => { allServers().forEach((s) => selected.add(s)); render(); emit(); });
  host.querySelector("[data-none]")?.addEventListener("click", () => { selected.clear(); render(); emit(); });

  // перетаскивание карточек для изменения порядка
  host.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
    card.addEventListener("dragstart", () => { dragSrv = decodeURIComponent(card.dataset.card!); card.classList.add("dragging"); });
    card.addEventListener("dragend", () => { dragSrv = null; card.classList.remove("dragging"); });
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("drop-target");
      const target = decodeURIComponent(card.dataset.card!);
      if (!dragSrv || dragSrv === target) return;
      const order = allServers();
      const from = order.indexOf(dragSrv), to = order.indexOf(target);
      if (from < 0 || to < 0) return;
      order.splice(from, 1); order.splice(to, 0, dragSrv);
      dragSrv = null;
      propagate(await api.reorderServers(order));
    });
  });
}
