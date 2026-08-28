// Окно «Учётные записи» — только профили учёток (серверы/кластеры теперь на панели).
import { api } from "../bridge";
import type { Registry } from "../types";
import { icons } from "./icons";

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
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="regTitle">
      <div class="m-head">
        <div class="m-ic accent" aria-hidden="true">${icons.lock}</div>
        <h2 id="regTitle">Учётные записи</h2>
        <button class="icon-btn m-close" data-close aria-label="Закрыть">${icons.close}</button>
      </div>
      <div class="m-body">
        <div class="reg-note">Домен/логин/пароль для подключения к серверам. Пароли хранятся в Windows Credential Manager, в файле экспорта их нет. Домен — без слэша (напр. CORP); пусто = локальная.</div>
        <div class="reg-list" data-reglist></div>
        <div class="reg-foot"><button class="reg-act wide" data-add-profile>${icons.lock}<span>Добавить учётную запись</span></button></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("[data-close]")!.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("[data-add-profile]")!.addEventListener("click", addProfile);

  renderList();
}

export function openRegistry(): void { overlay.classList.add("open"); renderList(); }
export function close(): void { overlay.classList.remove("open"); }

export function setModalRegistry(r: Registry): void {
  registry = r;
  if (overlay?.classList.contains("open")) renderList();
}

function apply(r: Registry): void { registry = r; renderList(); hooks.onChange(r); }
const enc = encodeURIComponent;

function renderList(): void {
  const box = overlay.querySelector<HTMLElement>("[data-reglist]")!;
  box.innerHTML = registry.profiles.length
    ? registry.profiles.map((p) => {
        const kind = p.domain ? "доменная" : "локальная";
        return `
      <div class="reg-profile" data-edit="${enc(p.name)}" title="Изменить">
        <span class="rp-ic">${icons.lock}</span>
        <span class="rp-name"><b>${p.name}</b><span class="rp-login">${kind} · ${p.domain ? p.domain + "\\" : ""}${p.username}${p.saved ? ' · <span class="rp-saved">пароль сохранён</span>' : ' · <span class="rp-nosave">без пароля</span>'}</span></span>
        <div class="grow"></div>
        <button class="reg-x" data-del-profile="${enc(p.name)}" aria-label="Удалить учётную запись">${icons.close}</button>
      </div>`; }).join("")
    : '<div class="reg-hint">Учёток пока нет. Добавьте доменную, локальную или сервисную — потом назначите серверам.</div>';

  box.querySelectorAll<HTMLElement>("[data-del-profile]").forEach((b) =>
    b.addEventListener("click", async (e) => { e.stopPropagation(); apply(await api.removeProfile(decodeURIComponent(b.dataset.delProfile!))); }));
  box.querySelectorAll<HTMLElement>("[data-edit]").forEach((row) =>
    row.addEventListener("click", () => editProfile(decodeURIComponent(row.dataset.edit!))));
}

async function addProfile(): Promise<void> {
  const cred = await credentialForm("Новая учётная запись", null);
  if (!cred || !cred.name) return;
  apply(await api.setProfile(cred.name, cred.domain, cred.username, cred.password, cred.domain ? "domain" : "local"));
}

async function editProfile(name: string): Promise<void> {
  const p = registry.profiles.find((x) => x.name === name);
  if (!p) return;
  const cred = await credentialForm("Изменить учётную запись", p);
  if (!cred) return;
  apply(await api.setProfile(name, cred.domain, cred.username, cred.password, cred.domain ? "domain" : "local"));
}

function credentialForm(title: string, existing: { name: string; domain: string; username: string; saved?: boolean } | null): Promise<{ name: string; domain: string; username: string; password: string } | null> {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay overlay-top open";
    const passPh = existing?.saved ? "•••• сохранён (пусто — не менять)" : "Пароль";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.lock}</div><h2>${title}</h2></div>
        <div class="m-body cred-form">
          <input class="txt" data-name placeholder="Название (напр. Домен-администратор)" value="${existing ? existing.name.replace(/"/g, "&quot;") : ""}" ${existing ? "readonly" : ""} autocomplete="off" />
          <input class="txt" data-domain placeholder="Домен без слэша (пусто = локальная)" value="${existing ? existing.domain.replace(/"/g, "&quot;") : ""}" autocomplete="off" />
          <input class="txt" data-user placeholder="Логин" value="${existing ? existing.username.replace(/"/g, "&quot;") : ""}" autocomplete="off" />
          <input class="txt" type="password" data-pass placeholder="${passPh}" autocomplete="off" />
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
    ov.querySelector<HTMLInputElement>("[data-name]")!.focus();
  });
}
