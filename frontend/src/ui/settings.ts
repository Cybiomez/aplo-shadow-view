// Окно настроек: режим неограниченного доступа, список серверов, обновление.
import type { ShadowApi } from "../bridge";
import type { Settings } from "../types";
import { icons } from "./icons";
import { openModal } from "./modal";
import { enhanceSelects } from "./select";
import { toast } from "./toast";

interface Hooks {
  onUnrestrictedChange(on: boolean): void; // главный экран показывает плашку
}

let overlay: HTMLElement;
let api: ShadowApi;
let hooks: Hooks;
let settings: Settings;

export async function initSettings(a: ShadowApi, h: Hooks): Promise<void> {
  api = a;
  hooks = h;
  settings = await api.getSettings();

  overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="setTitle">
      <div class="m-head">
        <div class="m-ic accent" aria-hidden="true">${icons.gear}</div>
        <h2 id="setTitle">Настройки</h2>
        <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button>
      </div>
      <div class="m-body">
        <div class="sec">
          <div class="sec-label">Список серверов</div>
          <div class="set-row">
            <div class="s-text"><div class="s-title">Экспорт и импорт</div><div class="s-sub">Экспорт и импорт списка серверов. Без паролей.</div></div>
          </div>
          <div class="set-row">
            <button class="btn-line" data-export-reg>${icons.upload}Экспорт</button>
            <button class="btn-line" data-import-reg>${icons.download}Импорт</button>
          </div>
        </div>
        <div class="sec">
          <div class="sec-label">Режим неограниченного доступа</div>
          <div class="set-row">
            <div class="s-text">
              <div class="s-title">Подключение без подтверждения пользователя</div>
              <div class="s-sub">Добавляет /noConsentPrompt ко всем теневым подключениям. Работает, если на серверах политика теневого доступа выставлена в «полный контроль без разрешения» (через GPO).</div>
            </div>
            <label class="switch" title="Режим неограниченного доступа">
              <input type="checkbox" data-unrestricted role="switch" aria-label="Режим неограниченного доступа">
              <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            </label>
          </div>
        </div>
        <div class="sec">
          <div class="sec-label">Обновление</div>
          <div class="set-row">
            <div class="s-text"><div class="s-title">Канал обновлений</div><div class="s-sub">latest — стабильные версии, dev — тестовые сборки.</div></div>
            <div class="seg" data-channel>
              <button data-ch="latest">latest</button>
              <button data-ch="dev">dev</button>
            </div>
          </div>
          <div class="set-row"><div class="s-text field">Текущая версия: <b data-current>—</b></div></div>
          <div class="set-row">
            <button class="btn-line" data-check>${icons.refresh}Проверить обновления</button>
            <button class="btn-line solid" data-install style="display:none">${icons.install}Скачать и установить</button>
          </div>
          <div class="update-status" data-status></div>
        </div>
        <div class="ver">AploShadowView · экосистема Aplo</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // начальные значения из настроек
  markChannel(settings.channel);
  unrestrictedToggle().checked = settings.unrestrictedAccess;
  enhanceSelects(overlay);

  overlay.querySelector("[data-close]")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  q<HTMLElement>("[data-current]").textContent = "v" + (await api.getVersion());

  q<HTMLElement>("[data-export-reg]").addEventListener("click", async () => {
    const res = await api.exportFile("registry", "");
    toast(res.message, res.ok ? "ok" : "err");
  });
  q<HTMLElement>("[data-import-reg]").addEventListener("click", async () => {
    const res = await api.importFile();
    if (res === null) return;
    if ("error" in res) { toast("Ошибка импорта: " + (res as { error: string }).error, "err"); return; }
    toast(`Импортировано: серверов ${res.added.servers}`);
  });

  bindUnrestricted();
  bindUpdate();
}

const q = <T extends Element>(sel: string) => overlay.querySelector(sel) as T;
const unrestrictedToggle = () => q<HTMLInputElement>("[data-unrestricted]");

export function openSettings(): void { overlay.classList.add("open"); }
export function close(): void { overlay.classList.remove("open"); }
export function isSettingsOpen(): boolean { return overlay.classList.contains("open"); }

/** Держит тумблер синхронным с состоянием режима. */
export function syncUnrestricted(on: boolean): void {
  unrestrictedToggle().checked = on;
}

function bindUnrestricted(): void {
  const toggle = unrestrictedToggle();
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      toggle.checked = false; // включаем после подтверждения
      openModal({
        title: "Режим неограниченного доступа",
        icon: "warn", glyph: icons.lock,
        body: "Включить подключение к сеансам <b>без подтверждения пользователя</b> для всех серверов?",
        note: { kind: "crit", text: "Это ослабляет контур безопасности: администратор входит в чужой сеанс без согласия пользователя. Действует, пока не выключите." },
        confirm: "Включить", confirmKind: "warn",
        onConfirm: async () => {
          await api.setUnrestricted(true);
          toggle.checked = true;
          hooks.onUnrestrictedChange(true);
          toast("Режим неограниченного доступа включён");
        },
      });
    } else {
      api.setUnrestricted(false).then(() => {
        hooks.onUnrestrictedChange(false);
        toast("Режим неограниченного доступа выключен");
      });
    }
  });
}

function markChannel(ch: string): void {
  overlay.querySelectorAll<HTMLButtonElement>("[data-channel] button").forEach((b) => {
    b.classList.toggle("on", b.dataset.ch === ch);
  });
}

function bindUpdate(): void {
  const status = q<HTMLElement>("[data-status]");
  const checkBtn = q<HTMLButtonElement>("[data-check]");
  const installBtn = q<HTMLButtonElement>("[data-install]");
  let availableVersion = "";

  overlay.querySelector("[data-channel]")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    const ch = b.dataset.ch as Settings["channel"];
    settings.channel = ch;
    markChannel(ch);
    api.setChannel(ch);
    status.textContent = ""; status.className = "update-status";
    installBtn.style.display = "none";
  });

  checkBtn.addEventListener("click", async () => {
    checkBtn.classList.add("spin"); checkBtn.disabled = true;
    status.className = "update-status"; status.textContent = "Проверяю на GitHub…";
    installBtn.style.display = "none";
    try {
      const info = await api.checkUpdate();
      q<HTMLElement>("[data-current]").textContent = "v" + info.current;
      if (info.error) {
        status.className = "update-status"; status.textContent = "Не удалось проверить: " + info.error;
      } else if (info.available) {
        availableVersion = info.version;
        status.className = "update-status avail"; status.textContent = `Доступна версия v${info.version}`;
        installBtn.style.display = "";
      } else {
        status.className = "update-status ok"; status.textContent = "Установлена последняя версия";
      }
    } finally {
      checkBtn.classList.remove("spin"); checkBtn.disabled = false;
    }
  });

  installBtn.addEventListener("click", () => {
    openModal({
      title: "Установка обновления",
      icon: "accent", glyph: icons.check,
      body: `Скачать и установить <b>v${availableVersion}</b> поверх текущей версии?`,
      note: { text: "Работающая копия будет закрыта, файл заменён и программа перезапущена. Несохранённого состояния у программы нет." },
      confirm: "Установить",
      onConfirm: async () => {
        status.className = "update-status"; status.textContent = `Скачиваю v${availableVersion}…`;
        const res = await api.applyUpdate();
        status.className = "update-status " + (res.ok ? "ok" : "");
        status.textContent = res.message;
        if (res.ok) { installBtn.style.display = "none"; toast(res.message); }
        else toast(res.message, "err");
      },
    });
  });
}

/** Открыть настройки уже с запущенной проверкой обновлений (из баббла). */
export function triggerUpdateCheck(): void {
  const btn = overlay?.querySelector<HTMLButtonElement>("[data-check]");
  if (btn) btn.click();
}
