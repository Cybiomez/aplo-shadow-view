// Главный экран (v2, мультисервер): панель серверов, список сеансов с колонкой
// «Сервер», массовые операции, поиск, сортировка. Опрашивается только выбранное.
import { api } from "./bridge";
import type { ActionKind, PolicyState, Registry, ServerPoll, Session } from "./types";
import { icons } from "./ui/icons";
import { initModal, isModalOpen, openModal } from "./ui/modal";
import { initRegistryModal, openRegistry } from "./ui/registryModal";
import { initServerBar, selectedServers, setRegistry } from "./ui/serverBar";
import { initSettings, isSettingsOpen, openSettings, syncPolicy } from "./ui/settings";
import { toast } from "./ui/toast";
import { checkUpdateBubble } from "./ui/updateBubble";

const AUTO_REFRESH_MS = 60_000;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

type SortField = "name" | "status" | "idle" | "server";
type SortDir = "asc" | "desc";

/** Строка списка: сеанс + сервер, с которого он получен. */
type Row = Session & { server: string };

interface ActionDef {
  title: string;
  icon: "accent" | "warn" | "crit";
  glyph: string;
  body: (name: string, server: string) => string;
  note: { kind?: "" | "crit"; text: string };
  confirm: string;
  confirmKind: "" | "warn" | "crit";
  run: (r: Row) => Promise<{ ok: boolean; message: string }>;
}

const ACTIONS: Record<ActionKind, ActionDef> = {
  view: {
    title: "Теневое подключение — просмотр", icon: "accent", glyph: icons.view,
    body: (n, s) => `Подключиться к сеансу <b>${n}</b>${s ? ` на <b>${s}</b>` : ""} только для просмотра?`,
    note: { text: "Пользователь увидит запрос на своём экране и должен разрешить подключение." },
    confirm: "Подключиться", confirmKind: "",
    run: (r) => api.shadow(r.sid, "view", r.server),
  },
  control: {
    title: "Теневое подключение — управление", icon: "accent", glyph: icons.control,
    body: (n, s) => `Подключиться к сеансу <b>${n}</b>${s ? ` на <b>${s}</b>` : ""} с полным управлением?`,
    note: { text: "Пользователь увидит запрос на своём экране и должен разрешить подключение." },
    confirm: "Подключиться", confirmKind: "",
    run: (r) => api.shadow(r.sid, "control", r.server),
  },
  disconnect: {
    title: "Отключить сеанс", icon: "warn", glyph: icons.disconnect,
    body: (n, s) => `Отключить сеанс <b>${n}</b>${s ? ` на <b>${s}</b>` : ""}?`,
    note: { text: "Программы пользователя продолжат работать, несохранённые данные не теряются." },
    confirm: "Отключить", confirmKind: "warn",
    run: (r) => api.disconnect(r.sid, r.server),
  },
  logoff: {
    title: "Полный выход из системы", icon: "crit", glyph: icons.logoff,
    body: (n, s) => `Завершить сеанс <b>${n}</b>${s ? ` на <b>${s}</b>` : ""} с полным выходом?`,
    note: { kind: "crit", text: "Все несохранённые данные пользователя будут потеряны. Действие необратимо." },
    confirm: "Завершить сеанс", confirmKind: "crit",
    run: (r) => api.logoff(r.sid, r.server),
  },
};

let rows: Row[] = [];
let unreachable: string[] = [];
let searchQuery = "";
let sortField: SortField = "server";
let sortDir: SortDir = "asc";
const selectedRows = new Set<string>(); // ключ "server|sid"
let lastRefresh = Date.now();
let polling = false;
let policyTicker: number | null = null;

function rowKey(r: { server: string; sid: number }): string {
  return `${r.server}|${r.sid}`;
}

function initials(name: string): string {
  const parts = name.split(/[._\s-]+/).filter(Boolean);
  let s: string;
  if (parts.length >= 2) s = parts[0][0] + parts[1][0];
  else if (parts.length === 1) s = parts[0].slice(0, 2);
  else s = "?";
  return s.toUpperCase();
}

function parseIdle(idle: string): number {
  const s = idle.trim().toLowerCase();
  if (s === "нет" || s === "none" || s === "." || s === "") return 0;
  if (s === "—" || s === "-") return Number.MAX_SAFE_INTEGER;
  let m = s.match(/^(\d+)\+(\d+):(\d+)/);
  if (m) return +m[1] * 1440 + +m[2] * 60 + +m[3];
  m = s.match(/^(\d+):(\d+)/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(\d+)/);
  if (m) return +m[1];
  return Number.MAX_SAFE_INTEGER;
}

function cmp(a: Row, b: Row): number {
  switch (sortField) {
    case "name": return a.name.localeCompare(b.name, "ru");
    case "status": return (a.state === "active" ? 0 : 1) - (b.state === "active" ? 0 : 1);
    case "idle": return parseIdle(a.idle) - parseIdle(b.idle);
    case "server": return a.server.localeCompare(b.server, "ru");
  }
}

function visibleRows(): Row[] {
  const q = searchQuery.trim().toLowerCase();
  const list = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.server.toLowerCase().includes(q))
    : rows.slice();
  const sign = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => sign * cmp(a, b) || a.server.localeCompare(b.server, "ru") || a.name.localeCompare(b.name, "ru"));
  return list;
}

function el<T extends Element>(sel: string): T {
  return document.querySelector(sel) as T;
}
function searchInput(): HTMLInputElement {
  return el<HTMLInputElement>("[data-search]");
}

function template(): string {
  return `
  <div class="app">
    <div class="titlebar">
      <div class="mark" aria-hidden="true">${icons.logo}</div>
      <div class="title"><h1>AploShadowView</h1><p>Теневой доступ к сеансам RDS</p></div>
      <div class="grow"></div>
      <button class="icon-btn" data-settings title="Настройки" aria-label="Настройки">${icons.gear}</button>
    </div>

    <div class="emg" data-emg>
      <div class="e-ic" aria-hidden="true">${icons.lock}</div>
      <div class="e-text">Экстренный режим (локально): подключение <b>без подтверждения</b>. Вернётся автоматически.</div>
      <span class="cd mono" data-emg-cd aria-live="polite">0:00</span>
      <button class="e-off" data-emg-off>Выключить</button>
    </div>

    <div class="serverbar" data-serverbar></div>

    <div class="toolbar">
      <span class="count"><b data-count>0</b> сеансов</span>
      <span class="unreach" data-unreach></span>
      <div class="grow"></div>
      <span class="refresh-info" data-refresh-info>—</span>
      <button class="btn-refresh" data-refresh>${icons.refresh}Обновить</button>
    </div>

    <div class="controls">
      <div class="search">
        <span class="s-ic" aria-hidden="true">${icons.search}</span>
        <input type="text" data-search placeholder="Поиск по имени или серверу…" aria-label="Поиск" autocomplete="off" spellcheck="false" />
        <button class="s-clear" data-search-clear title="Очистить" aria-label="Очистить" style="display:none">${icons.close}</button>
      </div>
      <div class="sort-toggles" role="group" aria-label="Сортировка">
        <button class="sort-tg" data-field="server">Сервер<span class="dir" aria-hidden="true"></span></button>
        <button class="sort-tg" data-field="name">Имя<span class="dir" aria-hidden="true"></span></button>
        <button class="sort-tg" data-field="status">Статус<span class="dir" aria-hidden="true"></span></button>
        <button class="sort-tg" data-field="idle">Простой<span class="dir" aria-hidden="true"></span></button>
      </div>
    </div>

    <div class="massbar" data-massbar>
      <span class="mb-count"><b data-mb-count>0</b> выбрано</span>
      <div class="grow"></div>
      <button class="mb-btn" data-mass-disc>${icons.disconnect}Отключить выбранные</button>
      <button class="mb-btn crit" data-mass-logoff>${icons.logoff}Выйти выбранным</button>
      <button class="mb-btn ghost" data-select-disc>Выбрать все отключённые</button>
      <button class="mb-btn ghost" data-clear-sel>Снять выделение</button>
    </div>

    <div class="list" data-list></div>

    <button class="foot" data-log title="Открыть файл журнала">
      ${icons.journal}
      <span>Все действия записываются в журнал: администратор, время, действие, пользователь.</span>
      <span class="foot-open" aria-hidden="true">${icons.install}</span>
    </button>
  </div>`;
}

function hasSelection(): boolean {
  return selectedRows.size > 0;
}

function renderList(): void {
  const list = el<HTMLElement>("[data-list]");
  const items = visibleRows();
  const selecting = hasSelection();

  if (items.length === 0) {
    let msg: string;
    if (selectedServers().length === 0) msg = "Выберите серверы для просмотра на панели выше";
    else if (searchQuery.trim()) msg = "Нет сеансов по запросу";
    else if (polling) msg = "Опрашиваю выбранные серверы…";
    else msg = "На выбранных серверах нет пользователей";
    list.innerHTML = `<div class="empty">${msg}</div>`;
  } else {
    list.innerHTML = items.map((r) => {
      const key = rowKey(r);
      const checked = selectedRows.has(key) ? "checked" : "";
      const chip = r.state === "active"
        ? `<span class="chip active"><span class="cdot"></span>Активен</span>`
        : `<span class="chip disc">Отключён</span>`;
      const you = r.you ? " · вы" : "";
      const dis = selecting ? " disabled" : "";
      const btn = (k: ActionKind, cls: string, label: string, disable = false) =>
        `<button class="act ${cls}" data-act="${k}" data-key="${key}"${disable ? dis : ""}>${icons[k]}<span>${label}</span></button>`;
      return `<div class="row${selectedRows.has(key) ? " selected" : ""}">
        <label class="rowcheck"><input type="checkbox" data-check="${key}" ${checked}/></label>
        <div class="avatar" aria-hidden="true">${initials(r.name)}</div>
        <div class="who">
          <div class="name">${r.name}${you}</div>
          <div class="meta">${chip}<span class="sid mono">сеанс ${r.sid}</span><span>простой: ${r.idle}</span></div>
        </div>
        <div class="server-col mono" title="Сервер">${r.server || "локально"}</div>
        <div class="actions">
          ${btn("view", "view", "Просмотр", true)}
          ${btn("control", "control", "Управление", true)}
          ${btn("disconnect", "disconnect", "Отключить")}
          ${btn("logoff", "logoff", "Выход")}
        </div>
      </div>`;
    }).join("");
  }
  el<HTMLElement>("[data-count]").textContent = String(rows.length);
  renderUnreachable();
  renderMassbar();
}

function renderUnreachable(): void {
  const box = el<HTMLElement>("[data-unreach]");
  box.textContent = unreachable.length ? `· не отвечают: ${unreachable.join(", ")}` : "";
}

function renderMassbar(): void {
  const bar = el<HTMLElement>("[data-massbar]");
  bar.classList.toggle("show", hasSelection());
  el<HTMLElement>("[data-mb-count]").textContent = String(selectedRows.size);
}

async function refresh(manual: boolean): Promise<void> {
  const servers = selectedServers();
  if (servers.length === 0) {
    rows = []; unreachable = [];
    renderList();
    el<HTMLElement>("[data-refresh-info]").textContent = "—";
    return;
  }
  polling = true;
  if (rows.length === 0) renderList();
  const polls: ServerPoll[] = await api.pollServers(servers);
  polling = false;

  rows = [];
  unreachable = [];
  for (const p of polls) {
    if (!p.ok) { unreachable.push(p.server); continue; }
    for (const s of p.sessions) rows.push({ ...s, server: p.server });
  }
  // подчистить выделение от исчезнувших строк
  const present = new Set(rows.map(rowKey));
  for (const k of [...selectedRows]) if (!present.has(k)) selectedRows.delete(k);

  renderList();
  lastRefresh = Date.now();
  el<HTMLElement>("[data-refresh-info]").textContent = "обновлено только что";
  if (manual) {
    const b = el<HTMLElement>("[data-refresh]");
    b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
  }
}

function fmtAgo(sec: number): string {
  if (sec < 5) return "обновлено только что";
  if (sec < 60) return `обновлено ${sec} с назад`;
  return `обновлено ${Math.floor(sec / 60)} мин назад`;
}
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function paintPolicy(state: PolicyState): void {
  const emg = el<HTMLElement>("[data-emg]");
  const cd = el<HTMLElement>("[data-emg-cd]");
  syncPolicy(state);
  if (policyTicker) { clearInterval(policyTicker); policyTicker = null; }
  if (!state.active) { emg.classList.remove("on"); return; }
  emg.classList.add("on");
  let remaining = state.remaining;
  cd.textContent = fmtClock(remaining);
  policyTicker = window.setInterval(async () => {
    remaining -= 1;
    cd.textContent = fmtClock(Math.max(remaining, 0));
    if (remaining <= 0) {
      const fresh = await api.getPolicy();
      paintPolicy(fresh);
      if (!fresh.active) toast("Таймер истёк — вернулось к подтверждению пользователя");
    }
  }, 1000);
}

// --- Поиск + сортировка ---
function applySearch(): void {
  searchQuery = searchInput().value;
  el<HTMLElement>("[data-search-clear]").style.display = searchQuery ? "" : "none";
  renderList();
}
function clearSearch(): void {
  searchInput().value = "";
  applySearch();
  searchInput().focus();
}
function updateSortToggles(): void {
  document.querySelectorAll<HTMLButtonElement>(".sort-tg").forEach((btn) => {
    const active = btn.dataset.field === sortField;
    btn.classList.toggle("active", active);
    const dir = btn.querySelector(".dir")!;
    dir.innerHTML = active ? (sortDir === "asc" ? icons.arrowUp : icons.arrowDown) : "";
    active ? btn.setAttribute("aria-pressed", "true") : btn.removeAttribute("aria-pressed");
  });
}
function bindSearchAndSort(): void {
  const input = searchInput();
  input.addEventListener("input", applySearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applySearch(); }
    else if (e.key === "Escape") { e.preventDefault(); clearSearch(); }
  });
  el<HTMLElement>("[data-search-clear]").addEventListener("click", clearSearch);

  document.querySelectorAll<HTMLButtonElement>(".sort-tg").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field as SortField;
      if (field === sortField) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortField = field; sortDir = "asc"; }
      updateSortToggles();
      renderList();
    });
  });
  updateSortToggles();

  document.addEventListener("keydown", (e) => {
    if (isModalOpen() || isSettingsOpen()) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      input.focus(); input.value += e.key; e.preventDefault(); applySearch();
    } else if (e.key === "Backspace" && searchQuery) {
      input.focus(); input.value = input.value.slice(0, -1); e.preventDefault(); applySearch();
    }
  });
}

// --- Массовые операции ---
function runMass(kind: "disconnect" | "logoff"): void {
  const targets = rows.filter((r) => selectedRows.has(rowKey(r)));
  if (targets.length === 0) return;
  const a = ACTIONS[kind];
  openModal({
    title: kind === "disconnect" ? "Отключить выбранные сеансы" : "Выход выбранным пользователям",
    icon: a.icon, glyph: a.glyph,
    body: `Выполнить «${kind === "disconnect" ? "Отключить" : "Выход"}» для <b>${targets.length}</b> выбранных сеансов?`,
    note: kind === "logoff"
      ? { kind: "crit", text: "Несохранённые данные этих пользователей будут потеряны. Действие необратимо." }
      : { text: "Программы пользователей продолжат работать, они смогут вернуться к сеансам." },
    confirm: kind === "disconnect" ? "Отключить" : "Завершить сеансы",
    confirmKind: kind === "disconnect" ? "warn" : "crit",
    onConfirm: async () => {
      let ok = 0, fail = 0;
      for (const r of targets) {
        const res = await a.run(r);
        res.ok ? ok++ : fail++;
      }
      toast(`Готово: ${ok}${fail ? `, ошибок ${fail}` : ""}`, fail ? "err" : "ok");
      selectedRows.clear();
      refresh(false);
    },
  });
}

function bindActions(): void {
  el<HTMLElement>("[data-settings]").addEventListener("click", openSettings);
  el<HTMLElement>("[data-refresh]").addEventListener("click", () => refresh(true));
  el<HTMLElement>("[data-log]").addEventListener("click", async () => { await api.openLog(); toast("Журнал открыт"); });

  el<HTMLElement>("[data-emg-off]").addEventListener("click", async () => {
    const state = await api.disableEmergency();
    paintPolicy(state);
    toast("Режим без подтверждения выключен");
  });

  // массовая панель
  el<HTMLElement>("[data-mass-disc]").addEventListener("click", () => runMass("disconnect"));
  el<HTMLElement>("[data-mass-logoff]").addEventListener("click", () => runMass("logoff"));
  el<HTMLElement>("[data-clear-sel]").addEventListener("click", () => { selectedRows.clear(); renderList(); });
  el<HTMLElement>("[data-select-disc]").addEventListener("click", () => {
    rows.filter((r) => r.state === "disc").forEach((r) => selectedRows.add(rowKey(r)));
    renderList();
  });

  // список: чекбоксы выделения + действия
  el<HTMLElement>("[data-list]").addEventListener("click", (e) => {
    const check = (e.target as HTMLElement).closest<HTMLInputElement>("[data-check]");
    if (check) {
      const key = check.dataset.check!;
      check.checked ? selectedRows.add(key) : selectedRows.delete(key);
      renderList();
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".act");
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const kind = btn.dataset.act as ActionKind;
    const row = rows.find((r) => rowKey(r) === btn.dataset.key);
    if (!row) return;
    const a = ACTIONS[kind];
    openModal({
      title: a.title, icon: a.icon, glyph: a.glyph,
      body: a.body(row.name, row.server), note: a.note, confirm: a.confirm, confirmKind: a.confirmKind,
      onConfirm: async () => {
        const res = await a.run(row);
        toast(res.message, res.ok ? "ok" : "err");
        if (kind === "disconnect" || kind === "logoff") refresh(false);
      },
    });
  });
}

export async function bootstrap(): Promise<void> {
  document.getElementById("app")!.innerHTML = template();
  initModal();

  await initSettings(api, { onPolicyChange: paintPolicy });

  const registry: Registry = await api.getRegistry();
  await initRegistryModal({ onChange: (r) => setRegistry(r) });
  initServerBar(el<HTMLElement>("[data-serverbar]"), registry, {
    onSelectionChange: () => refresh(false),
    onManage: openRegistry,
  });

  bindActions();
  bindSearchAndSort();
  renderList(); // стартовый пустой экран
  paintPolicy(await api.getPolicy());

  const hook = { onOpenSettings: openSettings };
  checkUpdateBubble(hook);
  setInterval(() => checkUpdateBubble(hook), UPDATE_CHECK_MS);

  setInterval(() => {
    const sec = Math.round((Date.now() - lastRefresh) / 1000);
    if (selectedServers().length) el<HTMLElement>("[data-refresh-info]").textContent = fmtAgo(sec);
    if (sec >= AUTO_REFRESH_MS / 1000 && selectedServers().length) refresh(false);
  }, 1000);
}
