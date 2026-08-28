// Управление реестром: серверы, кластеры, учётные записи, привязка, импорт/экспорт.
import { api } from "../bridge";
import type { Registry, ServerAuth } from "../types";
import { icons } from "./icons";
import { textPrompt } from "./modal";
import { toast } from "./toast";

interface Hooks {
  onChange(registry: Registry): void;
}

let overlay: HTMLElement;
let hooks: Hooks;
let registry: Registry = { clusters: [], servers: [], profiles: [], serverConfig: {} };

export async function initRegistryModal(h: Hooks): Promise<void> {
  hooks = h;
  registry = await api.getRegistry();

  overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="regTitle">
      <div class="m-head">
        <div class="m-ic accent" aria-hidden="true">${icons.logo}</div>
        <h2 id="regTitle">Серверы, кластеры и учётные записи</h2>
        <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button>
      </div>
      <div class="m-body">
        <div class="reg-toolbar">
          <button class="reg-act" data-add-cluster>${icons.folderPlus}<span>Кластер</span></button>
          <button class="reg-act" data-add-server>${icons.serverPlus}<span>Сервер</span></button>
          <button class="reg-act" data-add-profile>${icons.lock}<span>Учётка</span></button>
          <button class="reg-act" data-import>${icons.download}<span>Импорт</span></button>
        </div>
        <div class="reg-note">Сервер — сетевое имя или IP. Учётка (домен/логин/пароль) хранится в Windows Credential Manager, в файле экспорта паролей нет. «Локально» — под текущей учётной записью, без ввода.</div>
        <div class="reg-list" data-reglist></div>
        <div class="reg-foot"><button class="reg-act wide" data-export-all>${icons.upload}<span>Экспорт всего реестра (без паролей)</span></button></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("[data-close]")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-add-cluster]")!.addEventListener("click", addCluster);
  overlay.querySelector("[data-add-server]")!.addEventListener("click", () => addServer(""));
  overlay.querySelector("[data-add-profile]")!.addEventListener("click", addProfile);
  overlay.querySelector("[data-import]")!.addEventListener("click", doImport);
  overlay.querySelector("[data-export-all]")!.addEventListener("click", () => exportFile("registry", ""));

  renderList();
}

export function openRegistry(): void { overlay.classList.add("open"); renderList(); }
export function close(): void { overlay.classList.remove("open"); }

function apply(r: Registry): void { registry = r; renderList(); hooks.onChange(r); }
const enc = encodeURIComponent;


function authSelect(host: string): string {
  const cur = registry.serverConfig[host]?.auth;
  const mode = cur?.mode ?? "local";
  const curProfile = cur?.mode === "profile" ? cur.profile : "";
  const opts = [
    `<option value="local"${mode === "local" ? " selected" : ""}>локально</option>`,
    ...registry.profiles.map((p) =>
      `<option value="profile:${enc(p.name)}"${mode === "profile" && curProfile === p.name ? " selected" : ""}>${p.name}</option>`),
    `<option value="explicit"${mode === "explicit" ? " selected" : ""}>свои учётные данные…</option>`,
  ].join("");
  return `<select class="auth-sel" data-auth="${enc(host)}">${opts}</select>`;
}

function renderList(): void {
  const box = overlay.querySelector<HTMLElement>("[data-reglist]")!;

  const profilesHtml = `
    <div class="reg-section">
      <div class="reg-sec-title">Учётные записи</div>
      ${registry.profiles.length
        ? registry.profiles.map((p) => `
          <div class="reg-profile">
            <span class="rp-ic">${icons.lock}</span>
            <span class="rp-name"><b>${p.name}</b><span class="rp-login">${p.domain ? p.domain + "\\" : ""}${p.username}</span></span>
            <div class="grow"></div>
            <button class="reg-x" data-del-profile="${enc(p.name)}" aria-label="Удалить учётку">${icons.close}</button>
          </div>`).join("")
        : '<div class="reg-empty">Нет учёток. «Учётка» — добавить доменную/локальную/сервисную.</div>'}
    </div>`;

  const serverRow = (host: string, cluster: string) => `
    <div class="reg-srv-row">
      <span class="rs-name mono">${host}</span>
      <div class="grow"></div>
      <span class="rs-auth" title="Учётная запись">${authSelect(host)}</span>
      <button class="reg-mini" data-test="${enc(host)}" title="Проверить доступ по сети (RPC/SMB) под выбранной учёткой — получится ли список сеансов">Проверить</button>
      <button class="reg-x" data-del-server="${enc(host)}" data-in="${enc(cluster)}" aria-label="Убрать">${icons.close}</button>
    </div>`;

  const clustersHtml = registry.clusters.map((c) => `
    <div class="reg-cluster">
      <div class="reg-cluster-head">
        <b>${c.name}</b><span class="reg-count">${c.servers.length}</span>
        <div class="grow"></div>
        <button class="reg-mini" data-add-in="${enc(c.name)}">+ сервер</button>
        <button class="reg-mini" data-export-cluster="${enc(c.name)}">экспорт</button>
        <button class="reg-mini danger" data-del-cluster="${enc(c.name)}">${icons.close}</button>
      </div>
      <div class="reg-cluster-body">
        ${c.servers.map((srv) => serverRow(srv, c.name)).join("") || '<span class="reg-empty">пусто</span>'}
      </div>
    </div>`).join("");

  const standalone = registry.servers.length ? `
    <div class="reg-cluster">
      <div class="reg-cluster-head"><b>Без кластера</b><span class="reg-count">${registry.servers.length}</span></div>
      <div class="reg-cluster-body">${registry.servers.map((srv) => serverRow(srv, "")).join("")}</div>
    </div>` : "";

  const empty = (!registry.clusters.length && !registry.servers.length)
    ? '<div class="reg-hint">Серверов нет. Добавьте кластер или сервер, либо импортируйте из файла.</div>' : "";

  box.innerHTML = profilesHtml + clustersHtml + standalone + empty;
  bindRows(box);
}

function bindRows(box: HTMLElement): void {
  box.querySelectorAll<HTMLElement>("[data-del-profile]").forEach((b) =>
    b.addEventListener("click", async () => apply(await api.removeProfile(decodeURIComponent(b.dataset.delProfile!)))));
  box.querySelectorAll<HTMLElement>("[data-add-in]").forEach((b) =>
    b.addEventListener("click", () => addServer(decodeURIComponent(b.dataset.addIn!))));
  box.querySelectorAll<HTMLElement>("[data-del-cluster]").forEach((b) =>
    b.addEventListener("click", async () => apply(await api.removeCluster(decodeURIComponent(b.dataset.delCluster!)))));
  box.querySelectorAll<HTMLElement>("[data-export-cluster]").forEach((b) =>
    b.addEventListener("click", () => exportFile("cluster", decodeURIComponent(b.dataset.exportCluster!))));
  box.querySelectorAll<HTMLElement>("[data-del-server]").forEach((b) =>
    b.addEventListener("click", async () =>
      apply(await api.removeServer(decodeURIComponent(b.dataset.delServer!), decodeURIComponent(b.dataset.in || "")))));
  box.querySelectorAll<HTMLButtonElement>("[data-test]").forEach((b) =>
    b.addEventListener("click", async () => {
      const host = decodeURIComponent(b.dataset.test!);
      b.textContent = "…"; b.disabled = true;
      const res = await api.testServer(host);
      b.textContent = "Проверить"; b.disabled = false;
      toast(res.ok ? `${host}: доступен — список сеансов получен` : `${host}: не удалось (${res.error || "нет доступа по RPC/SMB"})`, res.ok ? "ok" : "err");
    }));
  box.querySelectorAll<HTMLSelectElement>("[data-auth]").forEach((sel) =>
    sel.addEventListener("change", () => onAuthChange(decodeURIComponent(sel.dataset.auth!), sel.value)));
}

async function onAuthChange(host: string, value: string): Promise<void> {
  if (value === "local") { apply(await api.setServerAuth(host, { mode: "local" })); return; }
  if (value.startsWith("profile:")) {
    apply(await api.setServerAuth(host, { mode: "profile", profile: decodeURIComponent(value.slice(8)) }));
    return;
  }
  // свои учётные данные для этого сервера
  const cred = await credentialForm(`Учётные данные для ${host}`, false);
  if (!cred) { renderList(); return; } // отмена — вернуть выбор
  const auth: ServerAuth = { mode: "explicit", domain: cred.domain, username: cred.username };
  apply(await api.setServerAuth(host, auth, cred.password));
}

async function addCluster(): Promise<void> {
  const name = await textPrompt("Новый кластер", "Имя кластера");
  if (name) apply(await api.addCluster(name));
}
async function addServer(cluster: string): Promise<void> {
  const name = await textPrompt(cluster ? `Сервер в «${cluster}»` : "Сервер вне кластеров", "Имя или IP сервера");
  if (name) apply(await api.addServer(name, cluster));
}
async function addProfile(): Promise<void> {
  const cred = await credentialForm("Новая учётная запись", true);
  if (!cred || !cred.name) return;
  apply(await api.setProfile(cred.name, cred.domain, cred.username, cred.password, "domain"));
}

async function exportFile(kind: string, name: string): Promise<void> {
  const res = await api.exportFile(kind, name);
  toast(res.message, res.ok ? "ok" : "err");
}
async function doImport(): Promise<void> {
  const res = await api.importFile();
  if (res === null) return;
  if ("error" in res) { toast("Ошибка импорта: " + (res as { error: string }).error, "err"); return; }
  apply(res.registry);
  toast(`Импортировано: кластеров ${res.added.clusters}, серверов ${res.added.servers}`);
}

/** Форма учётных данных. needName — спросить имя профиля (для профиля, не для сервера). */
function credentialForm(title: string, needName: boolean): Promise<{ name: string; domain: string; username: string; password: string } | null> {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay overlay-top open";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.lock}</div><h2>${title}</h2></div>
        <div class="m-body cred-form">
          ${needName ? '<input class="txt" data-name placeholder="Название учётки (напр. Домен-админ)" autocomplete="off" />' : ""}
          <input class="txt" data-domain placeholder="Домен (пусто = локальная учётка)" autocomplete="off" />
          <input class="txt" data-user placeholder="Логин" autocomplete="off" />
          <input class="txt" type="password" data-pass placeholder="Пароль" autocomplete="off" />
        </div>
        <div class="m-foot"><button class="mbtn" data-c>Отмена</button><button class="mbtn primary" data-ok>Сохранить</button></div>
      </div>`;
    document.body.appendChild(ov);
    const val = (sel: string) => (ov.querySelector<HTMLInputElement>(sel)?.value ?? "").trim();
    const done = (ok: boolean) => {
      const r = ok ? { name: val("[data-name]"), domain: val("[data-domain]"), username: val("[data-user]"), password: ov.querySelector<HTMLInputElement>("[data-pass]")!.value } : null;
      ov.remove(); resolve(r);
    };
    ov.querySelector("[data-c]")!.addEventListener("click", () => done(false));
    ov.querySelector("[data-ok]")!.addEventListener("click", () => done(true));
    ov.addEventListener("click", (e) => { if (e.target === ov) done(false); });
    (ov.querySelector(needName ? "[data-name]" : "[data-user]") as HTMLInputElement).focus();
  });
}
