
import { api } from "../bridge";
import type { Registry, ServerAuth } from "../types";
import { icons } from "./icons";
import { openModal } from "./modal";
import { enhanceSelects } from "./select";
import { toast } from "./toast";

const enc = encodeURIComponent;

function overlayEl(inner: string): HTMLElement {
  const ov = document.createElement("div");
  ov.className = "overlay overlay-top open";
  ov.innerHTML = inner;
  document.body.appendChild(ov);
  return ov;
}

/** Форма сервера. host задан → редактирование; иначе добавление.
 * Возвращает обновлённый реестр или null при отмене. */
export function openServerForm(registry: Registry, host: string | null): Promise<Registry | null> {
  return new Promise((resolve) => {
    const editing = !!host;
    const cfg = host ? (registry.serverConfig[host] || {}) : {};
    const auth = cfg.auth ?? { mode: "profile" as const };

    const profileOpts = registry.profiles.map((p) =>
      `<option value="${enc(p.name)}"${auth.mode === "profile" && auth.profile === p.name ? " selected" : ""}>${p.name}</option>`).join("");
    const passSaved = cfg.authSaved;

    const ov = overlayEl(`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.serverPlus}</div>
          <h2>${editing ? "Настройки сервера" : "Новый сервер"}</h2>
          <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button></div>
        <div class="m-body">
          <div class="ss-field"><label>Адрес (сетевое имя или IP)</label>
            ${editing ? `<div class="ss-static mono">${host}</div>` : '<input class="txt" data-addr placeholder="SERVER-01 или 10.0.0.5" autocomplete="off" />'}
          </div>
          <div class="ss-field"><label>Отображаемое имя (необязательно)</label>
            <input class="txt" data-name placeholder="Терминал-1С" value="${(cfg.displayName || "").replace(/"/g, "&quot;")}" autocomplete="off" /></div>
          <label class="ss-toggle"><input type="checkbox" data-showip ${cfg.showIp ? "checked" : ""} /><span>Показывать IP после имени</span></label>

          <div class="ss-field"><label>Учётная запись</label>
            <select class="txt" data-authmode>
              <option value="profile"${auth.mode !== "explicit" ? " selected" : ""}>Профиль учётной записи / локально</option>
              <option value="explicit"${auth.mode === "explicit" ? " selected" : ""}>Свои учётные данные</option>
            </select></div>
          <div class="ss-auth" data-profile-block ${auth.mode === "explicit" ? 'style="display:none"' : ""}>
            <select class="txt" data-profile>
              <option value="">— локально (текущая учётная запись) —</option>
              ${profileOpts}
            </select>
          </div>
          <div class="ss-auth" data-explicit-block ${auth.mode !== "explicit" ? 'style="display:none"' : ""}>
            <input class="txt" data-domain placeholder="Домен без слэша (оставить пустым для локальной)" value="${auth.mode === "explicit" ? (auth.domain || "") : ""}" autocomplete="off" />
            <input class="txt" data-user placeholder="Логин" value="${auth.mode === "explicit" ? (auth.username || "") : ""}" autocomplete="off" />
            <input class="txt" type="password" data-pass placeholder="${passSaved ? "Пароль (введите новый для изменения)" : "Пароль"}" autocomplete="off" />
          </div>
        </div>
        <div class="m-foot">
          ${editing
            ? '<button class="mbtn" data-export title="Экспортировать этот сервер в файл">Экспорт</button><button class="mbtn danger" data-delete>Удалить сервер</button>'
            : '<button class="mbtn" data-import title="Импортировать сервер из файла">Импорт из файла</button>'}
          <div class="grow"></div>
          <button class="mbtn" data-cancel>Отмена</button>
          <button class="mbtn primary" data-save>${editing ? "Сохранить" : "Добавить"}</button>
        </div>
      </div>`);

    enhanceSelects(ov);
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
      const addr = editing ? host! : q<HTMLInputElement>("[data-addr]").value.trim();
      if (!addr) { toast("Укажите адрес сервера", "err"); return; }
      const displayName = q<HTMLInputElement>("[data-name]").value.trim();
      const showIp = q<HTMLInputElement>("[data-showip]").checked;

      let reg: Registry = editing ? registry : await api.addServer(addr, "");
      reg = await api.setServerDisplay(addr, displayName, showIp);

      if (q<HTMLSelectElement>("[data-authmode]").value === "profile") {
        const prof = q<HTMLSelectElement>("[data-profile]").value;
        reg = await api.setServerAuth(addr, prof ? { mode: "profile", profile: prof } : { mode: "local" });
      } else {
        const domain = q<HTMLInputElement>("[data-domain]").value.trim();
        const username = q<HTMLInputElement>("[data-user]").value.trim();
        const password = q<HTMLInputElement>("[data-pass]").value;
        const a: ServerAuth = { mode: "explicit", domain, username };
        reg = await api.setServerAuth(addr, a, password);
      }
      toast(editing ? "Сервер сохранён" : `Сервер ${addr} добавлен`);
      done(reg);
    });

    ov.querySelector("[data-delete]")?.addEventListener("click", () => {
      openModal({
        title: "Удалить сервер", icon: "crit", glyph: icons.close,
        body: `Убрать сервер <b>${host}</b> из списка? Его настройки и учётные данные будут удалены.`,
        note: { text: "Сеансы на сервере не затрагиваются — удаляется только запись в приложении." },
        confirm: "Удалить", confirmKind: "crit",
        onConfirm: async () => { const reg = await api.removeServer(host!, ""); toast(`Сервер ${host} удалён`); done(reg); },
      });
    });
    ov.querySelector("[data-export]")?.addEventListener("click", async () => {
      const res = await api.exportFile("server", host!);
      toast(res.message, res.ok ? "ok" : "err");
    });
    ov.querySelector("[data-import]")?.addEventListener("click", async () => {
      const res = await api.importFile();
      if (res === null) return;
      if ("error" in res) { toast("Ошибка импорта: " + (res as { error: string }).error, "err"); return; }
      toast(`Импортировано: серверов ${res.added.servers}`);
      done(res.registry);  // закрыть форму, реестр обновлён
    });

    (ov.querySelector(editing ? "[data-name]" : "[data-addr]") as HTMLInputElement).focus();
  });
}


/** Как показывать сервер: отображаемое имя (+IP при включённом тумблере). */
export function serverLabel(host: string, registry: Registry): string {
  const cfg = registry.serverConfig[host];
  if (cfg?.displayName) return cfg.showIp ? `${cfg.displayName} (${host})` : cfg.displayName;
  return host;
}
