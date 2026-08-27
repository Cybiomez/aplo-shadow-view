// Главный экран: заголовок, плашка экстренного режима, список сеансов, футер.
import { api } from "./bridge";
import type { ActionKind, PolicyState, Session } from "./types";
import { icons } from "./ui/icons";
import { initModal, openModal } from "./ui/modal";
import { initSettings, openSettings, syncPolicy } from "./ui/settings";
import { toast } from "./ui/toast";

const AUTO_REFRESH_MS = 60_000;

// --- Описание четырёх действий строки ---
interface ActionDef {
  title: string;
  icon: "accent" | "warn" | "crit";
  glyph: string;
  body: (name: string) => string;
  note: { kind?: "" | "crit"; text: string };
  confirm: string;
  confirmKind: "" | "warn" | "crit";
  run: (s: Session) => Promise<{ ok: boolean; message: string }>;
}

const ACTIONS: Record<ActionKind, ActionDef> = {
  view: {
    title: "Теневое подключение — просмотр", icon: "accent", glyph: icons.view,
    body: (n) => `Подключиться к сеансу пользователя <b>${n}</b> только для просмотра?`,
    note: { text: "Пользователь увидит запрос на своём экране и должен разрешить подключение." },
    confirm: "Подключиться", confirmKind: "",
    run: (s) => api.shadow(s.sid, "view"),
  },
  control: {
    title: "Теневое подключение — управление", icon: "accent", glyph: icons.control,
    body: (n) => `Подключиться к сеансу <b>${n}</b> с полным управлением (мышь и клавиатура)?`,
    note: { text: "Пользователь увидит запрос на своём экране и должен разрешить подключение." },
    confirm: "Подключиться", confirmKind: "",
    run: (s) => api.shadow(s.sid, "control"),
  },
  disconnect: {
    title: "Отключить сеанс", icon: "warn", glyph: icons.disconnect,
    body: (n) => `Отключить сеанс пользователя <b>${n}</b>?`,
    note: { text: "Программы пользователя продолжат работать, несохранённые данные не теряются. Пользователь сможет вернуться к сеансу." },
    confirm: "Отключить", confirmKind: "warn",
    run: (s) => api.disconnect(s.sid),
  },
  logoff: {
    title: "Полный выход из системы", icon: "crit", glyph: icons.logoff,
    body: (n) => `Завершить сеанс пользователя <b>${n}</b> с полным выходом из системы?`,
    note: { kind: "crit", text: "Все несохранённые данные пользователя будут потеряны. Действие необратимо." },
    confirm: "Завершить сеанс", confirmKind: "crit",
    run: (s) => api.logoff(s.sid),
  },
};

let sessions: Session[] = [];
let lastRefresh = Date.now();
let policyTicker: number | null = null;

function initials(name: string): string {
  const p = name.split(/[._]/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

function el<T extends Element>(sel: string): T {
  return document.querySelector(sel) as T;
}

function template(): string {
  return `
  <div class="app">
    <div class="titlebar">
      <div class="mark" aria-hidden="true">${icons.logo}</div>
      <div class="title"><h1>AploShadowView</h1><p>Теневой доступ к сеансам RDS</p></div>
      <div class="grow"></div>
      <span class="server-pill" title="Имя берётся автоматически с этого сервера"><span class="dot"></span>Сервер <b data-server>—</b></span>
      <button class="icon-btn" data-settings title="Настройки" aria-label="Настройки">${icons.gear}</button>
    </div>

    <div class="emg" data-emg>
      <div class="e-ic" aria-hidden="true">${icons.lock}</div>
      <div class="e-text">Экстренный режим: подключение <b>без подтверждения пользователя</b>. Вернётся автоматически.</div>
      <span class="cd mono" data-emg-cd aria-live="polite">0:00</span>
      <button class="e-off" data-emg-off>Выключить</button>
    </div>

    <div class="toolbar">
      <span class="count"><b data-count>0</b> пользователей в системе</span>
      <div class="grow"></div>
      <span class="refresh-info" data-refresh-info>обновлено только что</span>
      <button class="btn-refresh" data-refresh>${icons.refresh}Обновить</button>
    </div>

    <div class="list" data-list></div>

    <div class="foot">${icons.journal}Все действия записываются в журнал: администратор, время, действие, пользователь.</div>
  </div>`;
}

function renderList(): void {
  const list = el<HTMLElement>("[data-list]");
  list.innerHTML = sessions.map((s) => {
    const chip = s.state === "active"
      ? `<span class="chip active"><span class="cdot"></span>Активен</span>`
      : `<span class="chip disc">Отключён</span>`;
    const you = s.you ? " · вы" : "";
    const btn = (k: ActionKind, cls: string, label: string) =>
      `<button class="act ${cls}" data-act="${k}" data-sid="${s.sid}">${icons[k]}<span>${label}</span></button>`;
    return `<div class="row">
      <div class="avatar" aria-hidden="true">${initials(s.name)}</div>
      <div class="who">
        <div class="name">${s.name}${you}</div>
        <div class="meta">${chip}<span class="sid mono">сеанс ${s.sid}</span><span>простой: ${s.idle}</span></div>
      </div>
      <div class="actions">
        ${btn("view", "view", "Просмотр")}
        ${btn("control", "control", "Управление")}
        ${btn("disconnect", "disconnect", "Отключить")}
        ${btn("logoff", "logoff", "Выход")}
      </div>
    </div>`;
  }).join("");
  el<HTMLElement>("[data-count]").textContent = String(sessions.length);
}

async function refresh(manual: boolean): Promise<void> {
  sessions = await api.listSessions();
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

// --- Экстренный режим: отрисовка плашки и отсчёта ---
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
      // таймер истёк — уточняем реальное состояние у backend (там его снял планировщик)
      const fresh = await api.getPolicy();
      paintPolicy(fresh);
      if (!fresh.active) toast("Таймер истёк — вернулось к подтверждению пользователя");
    }
  }, 1000);
}

function bindActions(): void {
  el<HTMLElement>("[data-settings]").addEventListener("click", openSettings);
  el<HTMLElement>("[data-refresh]").addEventListener("click", () => refresh(true));

  el<HTMLElement>("[data-emg-off]").addEventListener("click", async () => {
    const state = await api.disableEmergency();
    paintPolicy(state);
    toast("Режим без подтверждения выключен");
  });

  el<HTMLElement>("[data-list]").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".act");
    if (!btn) return;
    const kind = btn.dataset.act as ActionKind;
    const sid = Number(btn.dataset.sid);
    const session = sessions.find((s) => s.sid === sid);
    if (!session) return;
    const a = ACTIONS[kind];
    openModal({
      title: a.title, icon: a.icon, glyph: a.glyph,
      body: a.body(session.name), note: a.note, confirm: a.confirm, confirmKind: a.confirmKind,
      onConfirm: async () => {
        const res = await a.run(session);
        toast(res.message, res.ok ? "ok" : "err");
        if (kind === "disconnect" || kind === "logoff") refresh(false);
      },
    });
  });
}

export async function bootstrap(): Promise<void> {
  document.getElementById("app")!.innerHTML = template();
  initModal();

  el<HTMLElement>("[data-server]").textContent = await api.getServerName();
  await initSettings(api, { onPolicyChange: paintPolicy });

  bindActions();
  await refresh(false);
  paintPolicy(await api.getPolicy());

  // тикер строки «обновлено N назад» + авто-обновление раз в минуту
  setInterval(() => {
    const sec = Math.round((Date.now() - lastRefresh) / 1000);
    el<HTMLElement>("[data-refresh-info]").textContent = fmtAgo(sec);
    if (sec >= AUTO_REFRESH_MS / 1000) refresh(false);
  }, 1000);
}
