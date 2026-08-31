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
  ServerPoll,
  ServerLoad,
  Registry,
  ServerAuth,
  ImportResult,
} from "./types";

/** Контракт, которым пользуется весь UI. */
export interface ShadowApi {
  getServerName(): Promise<string>;
  getVersion(): Promise<string>;
  listSessions(server?: string): Promise<Session[]>;
  pollServers(servers: string[]): Promise<ServerPoll[]>;
  getResources(servers: string[]): Promise<Record<string, { load?: ServerLoad; sessions: Record<string, { ram_mb?: number; cpu_pct?: number }> }>>;
  shadow(sid: number, mode: ShadowMode, server?: string): Promise<ActionResult>;
  disconnect(sid: number, server?: string): Promise<ActionResult>;
  logoff(sid: number, server?: string): Promise<ActionResult>;

  // реестр серверов и кластеров
  getRegistry(): Promise<Registry>;
  addCluster(name: string): Promise<Registry>;
  removeCluster(name: string): Promise<Registry>;
  renameCluster(oldName: string, newName: string): Promise<Registry>;
  addServer(name: string, cluster?: string): Promise<Registry>;
  removeServer(name: string, cluster?: string): Promise<Registry>;
  moveServer(host: string, cluster: string): Promise<Registry>;
  reorderServers(order: string[]): Promise<Registry>;
  exportCluster(name: string): Promise<unknown>;
  exportServer(name: string): Promise<unknown>;
  exportRegistry(): Promise<unknown>;
  importRegistry(payload: unknown): Promise<ImportResult>;
  exportFile(kind: string, name?: string): Promise<ActionResult>;
  importFile(): Promise<ImportResult | null>;

  // учётные записи и привязка
  setProfile(name: string, domain: string, username: string, password: string, kind: string): Promise<Registry>;
  removeProfile(name: string): Promise<Registry>;
  setServerAuth(host: string, auth: ServerAuth, password?: string): Promise<Registry>;
  setClusterProfile(name: string, profile: string): Promise<Registry>;
  setServerZabbix(host: string, url: string, token: string): Promise<Registry>;
  setClusterZabbix(name: string, url: string): Promise<Registry>;
  setServerDisplay(host: string, displayName: string, showIp: boolean): Promise<Registry>;
  testServer(host: string): Promise<{ ok: boolean; error: string }>;

  getSettings(): Promise<Settings>;
  setMode(mode: string): Promise<void>;
  setChannel(channel: string): Promise<void>;
  setPolicyMinutes(minutes: number): Promise<void>;
  setShowResources(on: boolean): Promise<void>;
  setZabbix(url: string, token: string): Promise<void>;

  getPolicy(server?: string): Promise<PolicyState>;
  enableEmergency(server?: string): Promise<PolicyState>;
  disableEmergency(server?: string): Promise<PolicyState>;

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
  listSessions(server = "") { return this.api.list_sessions(server); }
  pollServers(servers: string[]) { return this.api.poll_servers(servers); }
  getResources(servers: string[]) { return this.api.get_resources(servers); }
  shadow(sid: number, mode: ShadowMode, server = "") { return this.api.shadow(sid, mode, server); }
  disconnect(sid: number, server = "") { return this.api.disconnect(sid, server); }
  logoff(sid: number, server = "") { return this.api.logoff(sid, server); }
  getRegistry() { return this.api.get_registry(); }
  addCluster(name: string) { return this.api.add_cluster(name); }
  removeCluster(name: string) { return this.api.remove_cluster(name); }
  renameCluster(o: string, n: string) { return this.api.rename_cluster(o, n); }
  addServer(name: string, cluster = "") { return this.api.add_server(name, cluster); }
  removeServer(name: string, cluster = "") { return this.api.remove_server(name, cluster); }
  moveServer(host: string, cluster: string) { return this.api.move_server(host, cluster); }
  reorderServers(order: string[]) { return this.api.reorder_servers(order); }
  exportCluster(name: string) { return this.api.export_cluster(name); }
  exportServer(name: string) { return this.api.export_server(name); }
  exportRegistry() { return this.api.export_registry(); }
  importRegistry(payload: unknown) { return this.api.import_registry(payload); }
  exportFile(kind: string, name = "") { return this.api.export_file(kind, name); }
  importFile() { return this.api.import_file(); }
  setProfile(name: string, domain: string, username: string, password: string, kind: string) { return this.api.set_profile(name, domain, username, password, kind); }
  removeProfile(name: string) { return this.api.remove_profile(name); }
  setServerAuth(host: string, auth: ServerAuth, password = "") { return this.api.set_server_auth(host, auth, password); }
  setClusterProfile(name: string, profile: string) { return this.api.set_cluster_profile(name, profile); }
  setServerZabbix(host: string, url: string, token: string) { return this.api.set_server_zabbix(host, url, token); }
  setClusterZabbix(name: string, url: string) { return this.api.set_cluster_zabbix(name, url); }
  setServerDisplay(host: string, displayName: string, showIp: boolean) { return this.api.set_server_display(host, displayName, showIp); }
  testServer(host: string) { return this.api.test_server(host); }
  getSettings() { return this.api.get_settings(); }
  setMode(mode: string) { return this.api.set_mode(mode); }
  setChannel(channel: string) { return this.api.set_channel(channel); }
  setPolicyMinutes(minutes: number) { return this.api.set_policy_minutes(minutes); }
  setShowResources(on: boolean) { return this.api.set_show_resources(on); }
  setZabbix(url: string, token: string) { return this.api.set_zabbix(url, token); }
  getPolicy(server = "") { return this.api.get_policy(server); }
  enableEmergency(server = "") { return this.api.enable_emergency(server); }
  disableEmergency(server = "") { return this.api.disable_emergency(server); }
  openLog() { return this.api.open_log(); }
  getUpdateNotification() { return this.api.get_update_notification(); }
  dismissUpdate(version: string) { return this.api.dismiss_update(version); }
  checkUpdate() { return this.api.check_update(); }
  applyUpdate() { return this.api.apply_update(); }
}

/** Заглушка для отладки вида в браузере (npm run dev). */
class MockApi implements ShadowApi {
  private registry: Registry = {
    clusters: [
      { name: "Терминалы Москва", servers: ["TS-01", "TS-02", "TS-03"] },
      { name: "1С-фермы", servers: ["1C-APP-01", "1C-APP-02"] },
    ],
    servers: ["STANDALONE-01"],
    profiles: [{ name: "Домен-админ", domain: "CORP", username: "admin", kind: "domain" }],
    serverConfig: {},
  };
  private base: Session[] = [
    { name: "admin", sid: 1, state: "active", idle: "нет", you: true },
    { name: "i.ivanov", sid: 3, state: "active", idle: "2 мин", you: false },
    { name: "p.petrov", sid: 4, state: "active", idle: "6 мин", you: false },
    { name: "s.sidorov", sid: 5, state: "active", idle: "13 мин", you: false },
    { name: "a.kozlov", sid: 2, state: "disc", idle: "—", you: false },
    { name: "d.morozov", sid: 6, state: "disc", idle: "5 сут", you: false },
  ];
  private settings: Settings = { mode: "manager", channel: "latest", policyMinutes: 15, showResources: true, zabbixUrl: "", zabbixConfigured: false };
  private policy: PolicyState = { active: false, remaining: 0, minutes: 15 };
  private timer: number | null = null;

  private wait<T>(value: T, ms = 250): Promise<T> {
    return new Promise((res) => setTimeout(() => res(value), ms));
  }

  getServerName() { return this.wait("TERMINAL-01"); }
  getVersion() { return this.wait("0.1.0"); }
  listSessions(_server = "") { return this.wait(this.base.slice()); }
  getResources(servers: string[]) {
    const out: Record<string, { load?: ServerLoad; sessions: Record<string, { ram_mb?: number; cpu_pct?: number }> }> = {};
    servers.forEach((srv, i) => {
      const sess: Record<string, { ram_mb: number; cpu_pct: number }> = {};
      this.base.slice(0, 3 + (i % 3)).forEach((s, j) => { sess[String(s.sid + i * 10)] = { ram_mb: 120 + j * 260 + i * 40, cpu_pct: (j * 7 + i * 3) % 60 }; });
      out[srv] = { load: { cpu: (30 + i * 17) % 95, ram_pct: (45 + i * 13) % 95, source: "demo" }, sessions: sess };
    });
    return this.wait(out, 200);
  }
  pollServers(servers: string[]) {
    // на каждый сервер — свой набор сеансов (сдвиг для наглядности); один «недоступен»
    const polls: ServerPoll[] = servers.map((srv, i) => {
      if (srv === "TS-03") return { server: srv, ok: false, sessions: [], error: "таймаут" };
      const shift = i;
      const sessions = this.base.slice(0, 3 + (i % 3)).map((s, j) => ({
        ...s, sid: s.sid + shift * 10, you: false,
        idle: j === 0 ? "нет" : `${(j + i) * 3} мин`,
        ram_mb: this.settings.showResources ? 120 + j * 260 + i * 40 : undefined,
        cpu_pct: this.settings.showResources ? (j * 7 + i * 3) % 60 : undefined,
      }));
      const load = this.settings.showResources
        ? { cpu: (30 + i * 17) % 95, ram_pct: (45 + i * 13) % 95, source: "demo" }
        : undefined;
      return { server: srv, ok: true, sessions, error: "", load };
    });
    return this.wait(polls, 400);
  }
  shadow(sid: number, mode: ShadowMode, _server = "") {
    const msg = mode === "view" ? `Запрос на просмотр отправлен (сеанс ${sid})` : `Запрос на управление отправлен (сеанс ${sid})`;
    return this.wait({ ok: true, message: msg });
  }
  disconnect(sid: number, _server = "") { return this.wait({ ok: true, message: `Сеанс ${sid} отключён` }); }
  logoff(sid: number, _server = "") { return this.wait({ ok: true, message: `Сеанс ${sid} — выход выполнен` }); }

  getRegistry() { return this.wait(structuredClone(this.registry)); }
  addCluster(name: string) { if (name && !this.registry.clusters.some((c) => c.name === name)) this.registry.clusters.push({ name, servers: [] }); return this.wait(structuredClone(this.registry)); }
  removeCluster(name: string) { this.registry.clusters = this.registry.clusters.filter((c) => c.name !== name); return this.wait(structuredClone(this.registry)); }
  renameCluster(o: string, n: string) { const c = this.registry.clusters.find((x) => x.name === o); if (c && n) c.name = n; return this.wait(structuredClone(this.registry)); }
  addServer(name: string, cluster = "") { if (!name) return this.wait(structuredClone(this.registry)); if (cluster) { const c = this.registry.clusters.find((x) => x.name === cluster); if (c && !c.servers.includes(name)) c.servers.push(name); } else if (!this.registry.servers.includes(name)) this.registry.servers.push(name); return this.wait(structuredClone(this.registry)); }
  removeServer(name: string, cluster = "") { if (cluster) { const c = this.registry.clusters.find((x) => x.name === cluster); if (c) c.servers = c.servers.filter((s) => s !== name); } else this.registry.servers = this.registry.servers.filter((s) => s !== name); delete this.registry.serverConfig[name]; return this.wait(structuredClone(this.registry)); }
  reorderServers(order: string[]) { const set = new Set(order); this.registry.servers = [...order.filter((x) => this.registry.servers.includes(x)), ...this.registry.servers.filter((x) => !set.has(x))]; return this.wait(structuredClone(this.registry)); }
  moveServer(host: string, cluster: string) { this.registry.servers = this.registry.servers.filter((s) => s !== host); this.registry.clusters.forEach((c) => c.servers = c.servers.filter((s) => s !== host)); if (cluster) { const c = this.registry.clusters.find((x) => x.name === cluster); if (c && !c.servers.includes(host)) c.servers.push(host); } else if (!this.registry.servers.includes(host)) this.registry.servers.push(host); return this.wait(structuredClone(this.registry)); }
  exportCluster(name: string) { const c = this.registry.clusters.find((x) => x.name === name); return this.wait(c ? { type: "aploshadowview/cluster", version: 1, cluster: c } : null); }
  exportServer(name: string) { return this.wait({ type: "aploshadowview/server", version: 1, server: name }); }
  exportRegistry() { return this.wait({ type: "aploshadowview/registry", version: 1, ...this.registry }); }
  importRegistry(_payload: unknown) { return this.wait<ImportResult>({ added: { clusters: 0, servers: 0 }, registry: structuredClone(this.registry) }); }
  exportFile(_kind: string, _name = "") { return this.wait<ActionResult>({ ok: true, message: "(демо) экспортировано в файл" }); }
  importFile() { return this.wait<ImportResult | null>({ added: { clusters: 1, servers: 2 }, registry: structuredClone(this.registry) }); }
  setProfile(name: string, domain: string, username: string, _password: string, kind: string) {
    const p = this.registry.profiles.find((x) => x.name === name);
    if (p) { p.domain = domain; p.username = username; p.kind = kind; }
    else this.registry.profiles.push({ name, domain, username, kind });
    return this.wait(structuredClone(this.registry));
  }
  removeProfile(name: string) { this.registry.profiles = this.registry.profiles.filter((p) => p.name !== name); return this.wait(structuredClone(this.registry)); }
  setServerAuth(host: string, auth: import("./types").ServerAuth, _password = "") { (this.registry.serverConfig[host] ||= {}).auth = auth; return this.wait(structuredClone(this.registry)); }
  setClusterProfile(name: string, profile: string) { const c = this.registry.clusters.find((x) => x.name === name); if (c) c.profile = profile; return this.wait(structuredClone(this.registry)); }
  setServerZabbix(host: string, url: string, token: string) { (this.registry.serverConfig[host] ||= {}).zabbix = { url, configured: !!(url && token) }; return this.wait(structuredClone(this.registry)); }
  setClusterZabbix(name: string, url: string) { const c = this.registry.clusters.find((x) => x.name === name); if (c) c.zabbix = { url }; return this.wait(structuredClone(this.registry)); }
  setServerDisplay(host: string, displayName: string, showIp: boolean) { (this.registry.serverConfig[host] ||= {}).displayName = displayName; this.registry.serverConfig[host].showIp = showIp; return this.wait(structuredClone(this.registry)); }
  testServer(host: string) { return this.wait({ ok: host !== "TS-03", error: host === "TS-03" ? "RPC недоступен (порты 135/445 закрыты)" : "" }, 500); }

  getSettings() { return this.wait(this.settings); }
  setMode(mode: string) { this.settings.mode = mode as Settings["mode"]; return this.wait(undefined); }
  setChannel(channel: string) { this.settings.channel = channel as Settings["channel"]; return this.wait(undefined); }
  setPolicyMinutes(minutes: number) { this.settings.policyMinutes = minutes; this.policy.minutes = minutes; return this.wait(undefined); }
  setShowResources(on: boolean) { this.settings.showResources = on; return this.wait(undefined); }
  setZabbix(url: string, _token: string) { this.settings.zabbixUrl = url; this.settings.zabbixConfigured = !!url; return this.wait(undefined); }

  getPolicy(_server = "") { return this.wait(this.policy); }
  enableEmergency(_server = "") {
    this.policy = { active: true, remaining: this.settings.policyMinutes * 60, minutes: this.settings.policyMinutes };
    if (this.timer) clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      this.policy.remaining -= 1;
      if (this.policy.remaining <= 0) { this.policy.active = false; this.policy.remaining = 0; if (this.timer) clearInterval(this.timer); }
    }, 1000);
    return this.wait(this.policy, 150);
  }
  disableEmergency(_server = "") {
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
