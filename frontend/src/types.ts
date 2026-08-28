// Общие типы UI ↔ backend. Имена полей совпадают с тем, что отдаёт Python.

/** Состояние сеанса пользователя на сервере. */
export type SessionState = "active" | "disc";

/** Один пользователь в системе (строка списка). */
export interface Session {
  name: string;      // имя пользователя
  sid: number;       // ID сеанса (для quser/mstsc/logoff)
  state: SessionState;
  idle: string;      // время простоя, как отдаёт quser ("нет", "2 мин", ...)
  you: boolean;      // это сеанс самого администратора
  ram_mb?: number;   // ОЗУ сеанса, МБ (если сбор ресурсов включён)
  cpu_pct?: number;  // ЦПУ сеанса, % (если сбор ресурсов включён)
}

/** Загрузка сервера. */
export interface ServerLoad {
  cpu?: number;          // ЦПУ %
  ram_pct?: number;      // ОЗУ занято, %
  ram_used_mb?: number;
  ram_total_mb?: number;
  source: string;        // zabbix | wmi | demo | none
}

/** Вид теневого подключения. */
export type ShadowMode = "view" | "control";

/** Действие над сеансом. */
export type ActionKind = ShadowMode | "disconnect" | "logoff";

/** Канал обновлений. */
export type Channel = "latest" | "dev";

/** Настройки приложения. */
export interface Settings {
  mode: "manager" | "local";
  channel: Channel;
  policyMinutes: number;   // таймер авто-возврата экстренного режима
  showResources: boolean;  // показывать ЦПУ/ОЗУ
  zabbixUrl: string;
  zabbixConfigured: boolean;
}

/** Состояние экстренной политики. */
export interface PolicyState {
  active: boolean;
  remaining: number; // секунд до авто-возврата (0, если выключено)
  minutes: number;   // на сколько включали
}

/** Итог проверки обновлений. */
export interface UpdateInfo {
  available: boolean;
  version: string;   // доступная версия или текущая
  current: string;
  error?: string;
}

/** Результат простого действия: успех + человекочитаемое сообщение. */
export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Уведомление об обновлении (баббл). */
export interface UpdateNotice {
  show: boolean;
  version?: string;
  current?: string;
  channel?: Channel;
}

/** Кластер: имя + список серверов. */
export interface Cluster { name: string; servers: string[]; profile?: string; zabbix?: { url: string }; }

/** Профиль учётной записи (пароль хранится в Credential Manager, не здесь). */
export interface Profile { name: string; domain: string; username: string; kind: string; }

/** Учётка сервера. */
export interface ServerAuth {
  mode: "local" | "profile" | "explicit";
  profile?: string;
  domain?: string;
  username?: string;
}

/** Конфигурация сервера в реестре. */
export interface ServerCfg { auth?: ServerAuth; zabbix?: { url: string; configured: boolean }; displayName?: string; showIp?: boolean; }

/** Реестр серверов и кластеров. */
export interface Registry {
  clusters: Cluster[];
  servers: string[];
  profiles: Profile[];
  serverConfig: Record<string, ServerCfg>;
}

/** Результат опроса одного сервера. */
export interface ServerPoll {
  server: string;
  ok: boolean;          // сервер ответил
  sessions: Session[];  // его сеансы
  error: string;        // причина, если ok=false
  load?: ServerLoad;    // загрузка сервера (если ресурсы включены)
}

/** Итог импорта реестра. */
export interface ImportResult {
  added: { clusters: number; servers: number };
  registry: Registry;
}
