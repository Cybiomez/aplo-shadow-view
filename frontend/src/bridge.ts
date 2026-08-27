/*
  Мост UI ↔ backend (Python).

  В окне вебвью pywebview кладёт методы Python в window.pywebview.api. Этот модуль
  прячет их за интерфейсом ShadowApi. Если pywebview нет (запуск фронта в браузере
  через `npm run dev`) — подставляется MockApi с учебными данными, чтобы смотреть
  и отлаживать вид без Python.
*/

import type {
  ActionResult,
  PolicyState,
  Session,
  Settings,
  ShadowMode,
  UpdateInfo,
  UpdateNotice,
} from "./types";

/** Контракт, которым пользуется весь UI. */
export interface ShadowApi {
  getServerName(): Promise<string>;
  getVersion(): Promise<string>;
  listSessions(): Promise<Session[]>;
  shadow(sid: number, mode: ShadowMode): Promise<ActionResult>;
  disconnect(sid: number): Promise<ActionResult>;
  logoff(sid: number): Promise<ActionResult>;

  getSettings(): Promise<Settings>;
  setChannel(channel: string): Promise<void>;
  setPolicyMinutes(minutes: number): Promise<void>;

  getPolicy(): Promise<PolicyState>;
  enableEmergency(): Promise<PolicyState>;   // включить режим без подтверждения
  disableEmergency(): Promise<PolicyState>;  // вернуть подтверждение вручную

  openLog(): Promise<void>;
  getUpdateNotification(): Promise<UpdateNotice>;
  dismissUpdate(version: string): Promise<void>;
  checkUpdate(): Promise<UpdateInfo>;
  applyUpdate(): Promise<ActionResult>;
}

/** Реальный мост — вызывает методы Python по их именам (snake_case). */
class RealApi implements ShadowApi {
  private get api(): any {
    return (window as any).pywebview.api;
  }
  getServerName() { return this.api.get_server_name(); }
  getVersion() { return this.api.get_version(); }
  listSessions() { return this.api.list_sessions(); }
  shadow(sid: number, mode: ShadowMode) { return this.api.shadow(sid, mode); }
  disconnect(sid: number) { return this.api.disconnect(sid); }
  logoff(sid: number) { return this.api.logoff(sid); }
  getSettings() { return this.api.get_settings(); }
  setChannel(channel: string) { return this.api.set_channel(channel); }
  setPolicyMinutes(minutes: number) { return this.api.set_policy_minutes(minutes); }
  getPolicy() { return this.api.get_policy(); }
  enableEmergency() { return this.api.enable_emergency(); }
  disableEmergency() { return this.api.disable_emergency(); }
  openLog() { return this.api.open_log(); }
  getUpdateNotification() { return this.api.get_update_notification(); }
  dismissUpdate(version: string) { return this.api.dismiss_update(version); }
  checkUpdate() { return this.api.check_update(); }
  applyUpdate() { return this.api.apply_update(); }
}

/** Заглушка для отладки вида в браузере (npm run dev). */
class MockApi implements ShadowApi {
  private sessions: Session[] = [
    { name: "admin", sid: 1, state: "active", idle: "нет", you: true },
    { name: "i.ivanov", sid: 3, state: "active", idle: "2 мин", you: false },
    { name: "p.petrov", sid: 4, state: "active", idle: "6 мин", you: false },
    { name: "s.sidorov", sid: 5, state: "active", idle: "13 мин", you: false },
    { name: "a.kozlov", sid: 2, state: "disc", idle: "—", you: false },
    { name: "d.morozov", sid: 6, state: "disc", idle: "5 сут", you: false },
  ];
  private settings: Settings = { channel: "latest", policyMinutes: 15 };
  private policy: PolicyState = { active: false, remaining: 0, minutes: 15 };
  private timer: number | null = null;

  private wait<T>(value: T, ms = 250): Promise<T> {
    return new Promise((res) => setTimeout(() => res(value), ms));
  }
  private byId(sid: number) {
    return this.sessions.find((s) => s.sid === sid)?.name ?? String(sid);
  }

  getServerName() { return this.wait("TERMINAL-01"); }
  getVersion() { return this.wait("0.1.0"); }
  listSessions() { return this.wait(this.sessions.slice()); }
  shadow(sid: number, mode: ShadowMode) {
    const who = this.byId(sid);
    const msg = mode === "view"
      ? `Запрос на просмотр отправлен пользователю ${who}`
      : `Запрос на управление отправлен пользователю ${who}`;
    return this.wait({ ok: true, message: msg });
  }
  disconnect(sid: number) { return this.wait({ ok: true, message: `Сеанс пользователя ${this.byId(sid)} отключён` }); }
  logoff(sid: number) { return this.wait({ ok: true, message: `Пользователь ${this.byId(sid)} выведен из системы` }); }

  getSettings() { return this.wait(this.settings); }
  setChannel(channel: string) { this.settings.channel = channel as Settings["channel"]; return this.wait(undefined); }
  setPolicyMinutes(minutes: number) { this.settings.policyMinutes = minutes; this.policy.minutes = minutes; return this.wait(undefined); }

  getPolicy() { return this.wait(this.policy); }
  enableEmergency() {
    this.policy = { active: true, remaining: this.settings.policyMinutes * 60, minutes: this.settings.policyMinutes };
    if (this.timer) clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      this.policy.remaining -= 1;
      if (this.policy.remaining <= 0) { this.policy.active = false; this.policy.remaining = 0; if (this.timer) clearInterval(this.timer); }
    }, 1000);
    return this.wait(this.policy, 150);
  }
  disableEmergency() {
    this.policy = { active: false, remaining: 0, minutes: this.settings.policyMinutes };
    if (this.timer) clearInterval(this.timer);
    return this.wait(this.policy, 150);
  }

  openLog() { console.log("(демо) открыть журнал"); return this.wait(undefined); }
  getUpdateNotification() { return this.wait<UpdateNotice>({ show: true, version: "0.2.0-dev.9", current: "0.1.0", channel: "dev" }); }
  dismissUpdate(_v: string) { return this.wait(undefined); }
  checkUpdate() {
    const dev = this.settings.channel === "dev";
    return this.wait<UpdateInfo>({
      available: dev,
      version: dev ? "0.2.0-dev.3" : "0.1.0",
      current: "0.1.0",
    }, 900);
  }
  applyUpdate() { return this.wait({ ok: true, message: "Обновление установлено — перезапуск" }, 1500); }
}

/**
 * Мост для UI. ВАЖНО: выбор реального/мок-моста ленивый — при первом обращении,
 * а не в момент импорта модуля. pywebview внедряет window.pywebview.api асинхронно
 * (по событию pywebviewready), и если зафиксировать мост при загрузке, он навсегда
 * станет MockApi. Прокси откладывает выбор до первого вызова (он идёт из bootstrap,
 * уже после готовности pywebview) → на Windows берётся RealApi.
 */
let impl: ShadowApi | null = null;
function resolve(): ShadowApi {
  if (!impl) {
    impl = (window as any).pywebview?.api ? new RealApi() : new MockApi();
  }
  return impl;
}

export const api: ShadowApi = new Proxy({} as ShadowApi, {
  get(_target, prop: string | symbol) {
    const target = resolve() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(target) : value;
  },
});
