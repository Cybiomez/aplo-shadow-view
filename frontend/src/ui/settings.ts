// Окно настроек: экстренный режим политики + обновление с GitHub.
import type { ShadowApi } from "../bridge";
import type { PolicyState, Settings } from "../types";
import { icons } from "./icons";
import { openModal } from "./modal";
import { toast } from "./toast";

interface Hooks {
  onPolicyChange(state: PolicyState): void; // главный экран показывает плашку/отсчёт
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
          <div class="sec-label">Экстренный доступ</div>
          <div class="set-row">
            <div class="s-text">
              <div class="s-title">Подключение без подтверждения пользователя</div>
              <div class="s-sub">Временно разрешает теневой вход, не спрашивая пользователя. Возврат гарантирует системный таймер — сработает, даже если программа закрыта или зависла.</div>
            </div>
            <label class="switch" title="Экстренный режим">
              <input type="checkbox" data-policy role="switch" aria-label="Режим без подтверждения пользователя">
              <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            </label>
          </div>
          <div class="set-row">
            <div class="s-text"><div class="s-title">Автоматический возврат через</div></div>
            <select class="mini" data-minutes aria-label="Таймер авто-возврата">
              <option value="5">5 минут</option>
              <option value="15">15 минут</option>
              <option value="30">30 минут</option>
            </select>
          </div>
        </div>
        <div class="sec">
          <div class="sec-label">Мониторинг ресурсов</div>
          <div class="set-row">
            <div class="s-text">
              <div class="s-title">Показывать ЦПУ и ОЗУ</div>
              <div class="s-sub">Загрузку серверов и потребление по сеансам. Опрос тяжелее — только для открытого по фильтрам.</div>
            </div>
            <label class="switch" title="Показывать ресурсы">
              <input type="checkbox" data-res role="switch" aria-label="Показывать ресурсы">
              <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            </label>
          </div>
          <div class="set-row">
            <div class="s-text"><div class="s-title">Zabbix (источник загрузки серверов)</div><div class="s-sub">Если задан — берём метрики оттуда, не грузим серверы. Пусто — через WMI.</div></div>
          </div>
          <div class="set-row"><input type="text" class="txt" data-zbx-url placeholder="http://zabbix/ (URL)" autocomplete="off" spellcheck="false" /></div>
          <div class="set-row"><input type="password" class="txt" data-zbx-token placeholder="API-токен Zabbix" autocomplete="off" /></div>
          <div class="set-row"><button class="btn-line" data-zbx-save>Сохранить Zabbix</button><span class="zbx-state" data-zbx-state></span></div>
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
  minutesSel().value = String(settings.policyMinutes);
  markChannel(settings.channel);
  q<HTMLInputElement>("[data-res]").checked = settings.showResources;
  q<HTMLInputElement>("[data-zbx-url]").value = settings.zabbixUrl || "";
  q<HTMLElement>("[data-zbx-state]").textContent = settings.zabbixConfigured ? "настроен" : "";

  overlay.querySelector("[data-close]")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  q<HTMLElement>("[data-current]").textContent = "v" + (await api.getVersion());

  q<HTMLInputElement>("[data-res]").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    settings.showResources = on;
    api.setShowResources(on);
  });
  q<HTMLElement>("[data-zbx-save]").addEventListener("click", async () => {
    const url = q<HTMLInputElement>("[data-zbx-url]").value.trim();
    const token = q<HTMLInputElement>("[data-zbx-token]").value.trim();
    await api.setZabbix(url, token);
    q<HTMLElement>("[data-zbx-state]").textContent = url && (token || settings.zabbixConfigured) ? "настроен" : "не задан";
    settings.zabbixUrl = url;
    settings.zabbixConfigured = !!(url && (token || settings.zabbixConfigured));
    toast("Настройки Zabbix сохранены");
  });

  bindPolicy();
  bindUpdate();
}

const q = <T extends Element>(sel: string) => overlay.querySelector(sel) as T;
const minutesSel = () => q<HTMLSelectElement>("[data-minutes]");
const policyToggle = () => q<HTMLInputElement>("[data-policy]");

export function openSettings(): void { overlay.classList.add("open"); }
export function close(): void { overlay.classList.remove("open"); }
export function isSettingsOpen(): boolean { return overlay.classList.contains("open"); }

/** Держит тумблер в модалке синхронным с реальным состоянием политики. */
export function syncPolicy(state: PolicyState): void {
  policyToggle().checked = state.active;
}

function bindPolicy(): void {
  policyToggle().addEventListener("change", () => {
    const toggle = policyToggle();
    if (toggle.checked) {
      toggle.checked = false; // включаем только после подтверждения
      const mins = parseInt(minutesSel().value, 10) || 15;
      openModal({
        title: "Экстренный режим доступа",
        icon: "warn", glyph: icons.lock,
        body: `Включить теневой доступ <b>без подтверждения пользователя</b> на ${mins} минут?`,
        note: { kind: "crit", text: "Это временно ослабляет контур безопасности. Режим вернётся к «с подтверждением» автоматически по системному таймеру — даже если программа будет закрыта или зависнет." },
        confirm: `Включить на ${mins} мин`, confirmKind: "warn",
        onConfirm: async () => {
          const state = await api.enableEmergency();
          toggle.checked = state.active;
          hooks.onPolicyChange(state);
          toast(`Режим без подтверждения включён на ${state.minutes} мин`);
        },
      });
    } else {
      api.disableEmergency().then((state) => {
        hooks.onPolicyChange(state);
        toast("Режим без подтверждения выключен");
      });
    }
  });

  minutesSel().addEventListener("change", () => {
    const mins = parseInt(minutesSel().value, 10) || 15;
    settings.policyMinutes = mins;
    api.setPolicyMinutes(mins);
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

