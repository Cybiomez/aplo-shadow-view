// Формы сервера и кластера (добавление/редактирование) + метка сервера.
import { api } from "../bridge";
import type { Registry, ServerAuth } from "../types";
import { icons } from "./icons";
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
 * defaultCluster — предвыбранный кластер (напр. активный). Возвращает реестр или null. */
export function openServerForm(registry: Registry, host: string | null, defaultCluster: string): Promise<Registry | null> {
  return new Promise((resolve) => {
    const editing = !!host;
    const cfg = host ? (registry.serverConfig[host] || {}) : {};
    const auth = cfg.auth ?? { mode: "profile" as const };
    const curCluster = host ? (registry.clusters.find((c) => c.servers.includes(host))?.name ?? "") : defaultCluster;

    const clusterOpts = [
      `<option value=""${curCluster === "" ? " selected" : ""}>Без кластера</option>`,
      ...registry.clusters.map((c) => `<option value="${enc(c.name)}"${curCluster === c.name ? " selected" : ""}>${c.name}</option>`),
    ].join("");
    const profileOpts = registry.profiles.map((p) =>
      `<option value="${enc(p.name)}"${auth.mode === "profile" && auth.profile === p.name ? " selected" : ""}>${p.name}</option>`).join("");
    const passSaved = cfg.authSaved;

    const ov = overlayEl(`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.serverPlus}</div>
          <h2>${editing ? "Настройки сервера" : "Новый сервер"}</h2>
          <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button></div>
        <div class="m-body">
          <div class="ss-field"><label>Адрес (имя или IP, можно IP:порт)</label>
            ${editing ? `<div class="ss-static mono">${host}</div>` : '<input class="txt" data-addr placeholder="напр. 10.0.0.5 или 10.0.0.5:40114" autocomplete="off" />'}
          </div>
          <div class="ss-field"><label>Кластер</label><select class="txt" data-cluster>${clusterOpts}</select></div>
          <div class="ss-field"><label>Отображаемое имя (необязательно)</label>
            <input class="txt" data-name placeholder="напр. Терминал-1С" value="${(cfg.displayName || "").replace(/"/g, "&quot;")}" autocomplete="off" /></div>
          <label class="ss-toggle"><input type="checkbox" data-showip ${cfg.showIp ? "checked" : ""} /><span>Показывать IP после имени</span></label>

          <div class="ss-field"><label>Учётная запись</label>
            <select class="txt" data-authmode>
              <option value="profile"${auth.mode !== "explicit" ? " selected" : ""}>Профиль учётки / локально</option>
              <option value="explicit"${auth.mode === "explicit" ? " selected" : ""}>Свои учётные данные</option>
            </select></div>
          <div class="ss-auth" data-profile-block ${auth.mode === "explicit" ? 'style="display:none"' : ""}>
            <select class="txt" data-profile>
              <option value="">— локально (текущая учётка) —</option>
              ${profileOpts}
            </select>
          </div>
          <div class="ss-auth" data-explicit-block ${auth.mode !== "explicit" ? 'style="display:none"' : ""}>
            <input class="txt" data-domain placeholder="Домен без слэша (пусто = локальная)" value="${auth.mode === "explicit" ? (auth.domain || "") : ""}" autocomplete="off" />
            <input class="txt" data-user placeholder="Логин" value="${auth.mode === "explicit" ? (auth.username || "") : ""}" autocomplete="off" />
            <input class="txt" type="password" data-pass placeholder="${passSaved ? "•••• сохранён (пусто — не менять)" : "Пароль"}" autocomplete="off" />
          </div>
        </div>
        <div class="m-foot"><button class="mbtn" data-cancel>Отмена</button><button class="mbtn primary" data-save>${editing ? "Сохранить" : "Добавить"}</button></div>
      </div>`);

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
      const cluster = q<HTMLSelectElement>("[data-cluster]").value;
      const displayName = q<HTMLInputElement>("[data-name]").value.trim();
      const showIp = q<HTMLInputElement>("[data-showip]").checked;

      let reg: Registry;
      if (editing) {
        reg = await api.moveServer(addr, cluster);        // сменить кластер (если поменяли)
      } else {
        reg = await api.addServer(addr, cluster);
      }
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

    (ov.querySelector(editing ? "[data-name]" : "[data-addr]") as HTMLInputElement).focus();
  });
}

/** Форма кластера. name задан → редактирование (имя + состав); иначе создание. */
export function openClusterForm(registry: Registry, name: string | null): Promise<Registry | null> {
  return new Promise((resolve) => {
    const editing = !!name;
    const current = editing ? (registry.clusters.find((c) => c.name === name)?.servers ?? []) : [];
    const all = [
      ...registry.servers,
      ...registry.clusters.flatMap((c) => c.servers),
    ];
    const uniq = [...new Set(all)];

    const serversHtml = uniq.length
      ? uniq.map((srv) => `<label class="cl-srv"><input type="checkbox" data-srv="${enc(srv)}" ${current.includes(srv) ? "checked" : ""}/>${srv}</label>`).join("")
      : '<span class="reg-empty">Серверов пока нет — добавьте отдельно кнопкой «Сервер».</span>';

    const ov = overlayEl(`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.folderPlus}</div>
          <h2>${editing ? "Кластер: " + name : "Новый кластер"}</h2>
          <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button></div>
        <div class="m-body">
          <div class="ss-field"><label>Название кластера</label>
            <input class="txt" data-clname value="${editing ? name!.replace(/"/g, "&quot;") : ""}" placeholder="напр. Терминалы Москва" autocomplete="off" /></div>
          <div class="ss-field"><label>Серверы в кластере</label><div class="cl-servers">${serversHtml}</div></div>
        </div>
        <div class="m-foot"><button class="mbtn" data-cancel>Отмена</button><button class="mbtn primary" data-save>${editing ? "Сохранить" : "Создать"}</button></div>
      </div>`);

    const q = <T extends Element>(sel: string) => ov.querySelector(sel) as T;
    const done = (r: Registry | null) => { ov.remove(); resolve(r); };
    q("[data-close]").addEventListener("click", () => done(null));
    q("[data-cancel]").addEventListener("click", () => done(null));
    ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });

    q("[data-save]").addEventListener("click", async () => {
      const newName = q<HTMLInputElement>("[data-clname]").value.trim();
      if (!newName) { toast("Укажите название кластера", "err"); return; }
      let reg = registry;
      if (editing && newName !== name) reg = await api.renameCluster(name!, newName);
      else if (!editing) reg = await api.addCluster(newName);

      const checked = [...ov.querySelectorAll<HTMLInputElement>("[data-srv]:checked")].map((c) => decodeURIComponent(c.dataset.srv!));
      const unchecked = [...ov.querySelectorAll<HTMLInputElement>("[data-srv]:not(:checked)")].map((c) => decodeURIComponent(c.dataset.srv!));
      for (const srv of checked) reg = await api.moveServer(srv, newName);
      // снятые, если были в этом кластере, → в «Без кластера»
      for (const srv of unchecked) {
        if ((reg.clusters.find((c) => c.name === newName)?.servers ?? []).includes(srv)) reg = await api.moveServer(srv, "");
      }
      toast(editing ? "Кластер сохранён" : `Кластер «${newName}» создан`);
      done(reg);
    });

    q<HTMLInputElement>("[data-clname]").focus();
  });
}

/** Как показывать сервер: отображаемое имя (+IP при включённом тумблере). */
export function serverLabel(host: string, registry: Registry): string {
  const cfg = registry.serverConfig[host];
  if (cfg?.displayName) return cfg.showIp ? `${cfg.displayName} (${host})` : cfg.displayName;
  return host;
}
