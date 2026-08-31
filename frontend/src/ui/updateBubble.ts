// Баббл уведомления об обновлении. Две кнопки:
//   «Отложить» — скрыть до следующего запуска приложения (память в сессии);
//   «Не показывать» — скрыть эту версию, пока не выйдет ещё свежее (память в config).
// Клик по телу баббла открывает Настройки (там кнопка установки).
import { api } from "../bridge";
import { icons } from "./icons";

let postponedThisSession = false;
let bubble: HTMLElement | null = null;

interface Hooks {
  onUpdate(): void; // открыть настройки и запустить проверку/установку
}

function build(hooks: Hooks): HTMLElement {
  const el = document.createElement("div");
  el.className = "update-bubble";
  el.innerHTML = `
    <div class="ub-body">
      <span class="ub-ic">${icons.install}</span>
      <span class="ub-text"><b data-title>Доступно обновление</b><span class="ub-sub" data-sub></span></span>
    </div>
    <div class="ub-actions">
      <button class="ub-btn solid" data-update>Обновить</button>
      <button class="ub-btn" data-postpone>Отложить</button>
      <button class="ub-btn ghost" data-dismiss>Не показывать</button>
    </div>`;
  el.querySelector("[data-update]")!.addEventListener("click", () => { hide(); hooks.onUpdate(); });
  el.querySelector("[data-postpone]")!.addEventListener("click", () => {
    postponedThisSession = true;
    hide();
  });
  el.querySelector("[data-dismiss]")!.addEventListener("click", async () => {
    const version = el.dataset.version || "";
    if (version) await api.dismissUpdate(version);
    hide();
  });
  document.body.appendChild(el);
  return el;
}

function hide(): void {
  if (bubble) bubble.classList.remove("show");
}

/** Проверить и показать баббл, если есть незакрытое обновление. */
export async function checkUpdateBubble(hooks: Hooks): Promise<void> {
  if (postponedThisSession) return; // в этой сессии уже отложили
  let notice;
  try {
    notice = await api.getUpdateNotification();
  } catch {
    return; // молча: проблемы сети не должны мешать работе
  }
  if (!notice.show || !notice.version) { hide(); return; }

  if (!bubble) bubble = build(hooks);
  bubble.dataset.version = notice.version;
  const channelLabel = notice.channel === "dev" ? " (канал dev)" : "";
  bubble.querySelector("[data-title]")!.textContent = `Доступно обновление v${notice.version}`;
  bubble.querySelector("[data-sub]")!.textContent = `Установлена v${notice.current}${channelLabel}.`;
  bubble.classList.add("show");
}
