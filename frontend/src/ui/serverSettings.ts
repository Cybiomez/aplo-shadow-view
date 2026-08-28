// Настройки карточки сервера: учётная запись, отображаемое имя, показывать IP.
import { api } from "../bridge";
import type { Registry, ServerAuth } from "../types";
import { icons } from "./icons";
import { toast } from "./toast";

const enc = encodeURIComponent;

/** Открыть настройки сервера. Возвращает обновлённый реестр (или null при отмене). */
export function openServerSettings(host: string, registry: Registry): Promise<Registry | null> {
  return new Promise((resolve) => {
    const cfg = registry.serverConfig[host] || {};
    const auth = cfg.auth ?? { mode: "profile" as const };
    const ov = document.createElement("div");
    ov.className = "overlay overlay-top open";

    const profileOpts = registry.profiles.map((p) =>
      `<option value="profile:${enc(p.name)}"${auth.mode === "profile" && auth.profile === p.name ? " selected" : ""}>${p.name}</option>`).join("");

    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.serverPlus}</div><h2>Настройки сервера</h2>
          <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button></div>
        <div class="m-body">
          <div class="ss-field"><label>Адрес</label><div class="ss-static mono">${host}</div></div>

          <div class="ss-field">
            <label>Отображаемое имя (необязательно)</label>
            <input class="txt" data-name placeholder="напр. Терминал-1С" value="${(cfg.displayName || "").replace(/"/g, "&quot;")}" autocomplete="off" />
          </div>
          <label class="ss-toggle">
            <input type="checkbox" data-showip ${cfg.showIp ? "checked" : ""} />
            <span>Показывать IP после имени</span>
          </label>

          <div class="ss-field">
            <label>Учётная запись</label>
            <select class="txt" data-authmode>
              <option value="profile"${auth.mode === "profile" ? " selected" : ""}>Профиль учётки</option>
              <option value="explicit"${auth.mode === "explicit" ? " selected" : ""}>Свои учётные данные</option>
            </select>
          </div>

          <div class="ss-auth" data-profile-block ${auth.mode === "explicit" ? 'style="display:none"' : ""}>
            <select class="txt" data-profile>${profileOpts || '<option value="">нет учёток — создайте в «Учётные записи»</option>'}</select>
          </div>

          <div class="ss-auth" data-explicit-block ${auth.mode === "profile" ? 'style="display:none"' : ""}>
            <input class="txt" data-domain placeholder="Домен (пусто = локальная)" value="${auth.mode === "explicit" ? (auth.domain || "") : ""}" autocomplete="off" />
            <input class="txt" data-user placeholder="Логин" value="${auth.mode === "explicit" ? (auth.username || "") : ""}" autocomplete="off" />
            <input class="txt" type="password" data-pass placeholder="Пароль (пусто = не менять)" autocomplete="off" />
          </div>
        </div>
        <div class="m-foot"><button class="mbtn" data-cancel>Отмена</button><button class="mbtn primary" data-save>Сохранить</button></div>
      </div>`;
    document.body.appendChild(ov);

    const q = <T extends Element>(sel: string) => ov.querySelector(sel) as T;
    const done = (r: Registry | null) => { ov.remove(); resolve(r); };

    q<HTMLSelectElement>("[data-authmode]").addEventListener("change", (e) => {
      const explicit = (e.target as HTMLSelectElement).value === "explicit";
      q<HTMLElement>("[data-profile-block]").style.display = explicit ? "none" : "";
      q<HTMLElement>("[data-explicit-block]").style.display = explicit ? "" : "none";
    });

    q("[data-close]").addEventListener("click", () => done(null));
    q("[data-cancel]").addEventListener("click", () => done(null));
    ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });

    q("[data-save]").addEventListener("click", async () => {
      const displayName = q<HTMLInputElement>("[data-name]").value.trim();
      const showIp = q<HTMLInputElement>("[data-showip]").checked;
      let reg = await api.setServerDisplay(host, displayName, showIp);

      const mode = q<HTMLSelectElement>("[data-authmode]").value;
      if (mode === "profile") {
        const val = q<HTMLSelectElement>("[data-profile]").value;
        const newAuth: ServerAuth = val ? { mode: "profile", profile: val } : { mode: "local" };
        reg = await api.setServerAuth(host, newAuth);
      } else {
        const domain = q<HTMLInputElement>("[data-domain]").value.trim();
        const username = q<HTMLInputElement>("[data-user]").value.trim();
        const password = q<HTMLInputElement>("[data-pass]").value;
        reg = await api.setServerAuth(host, { mode: "explicit", domain, username }, password);
      }
      toast("Настройки сервера сохранены");
      done(reg);
    });

    q<HTMLInputElement>("[data-name]").focus();
  });
}

/** Как показывать сервер в списке: отображаемое имя (+IP при включённом тумблере). */
export function serverLabel(host: string, registry: Registry): string {
  const cfg = registry.serverConfig[host];
  if (cfg?.displayName) {
    return cfg.showIp ? `${cfg.displayName} (${host})` : cfg.displayName;
  }
  return host;
}
