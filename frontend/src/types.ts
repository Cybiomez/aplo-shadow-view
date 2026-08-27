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
}

/** Вид теневого подключения. */
export type ShadowMode = "view" | "control";

/** Действие над сеансом. */
export type ActionKind = ShadowMode | "disconnect" | "logoff";

/** Канал обновлений. */
export type Channel = "latest" | "dev";

/** Настройки приложения. */
export interface Settings {
  channel: Channel;
  policyMinutes: number; // таймер авто-возврата экстренного режима
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
