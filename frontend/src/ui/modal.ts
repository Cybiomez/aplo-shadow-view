// Универсальное окно подтверждения. Один экземпляр на страницу, переиспользуется.
import { icons } from "./icons";

export interface ModalConfig {
  title: string;
  icon?: "accent" | "warn" | "crit";
  glyph?: string;              // ключ иконки в header
  body: string;                // HTML (допускается <b>)
  note?: { kind?: "" | "crit"; text: string };
  confirm?: string;            // подпись кнопки подтверждения
  confirmKind?: "" | "warn" | "crit";
  onConfirm?: () => void;
}

let overlay: HTMLElement;
let elIc: HTMLElement, elTitle: HTMLElement, elBody: HTMLElement, elConfirm: HTMLButtonElement, elCancel: HTMLButtonElement;
let pending: (() => void) | null = null;
let lastFocus: Element | null = null;

export function initModal(): void {
  overlay = document.createElement("div");
  overlay.className = "overlay overlay-confirm";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <div class="m-head">
        <div class="m-ic accent" data-ic aria-hidden="true"></div>
        <h2 id="mTitle" data-title>Подтверждение</h2>
      </div>
      <div class="m-body" data-body></div>
      <div class="m-foot">
        <button class="mbtn" data-cancel>Отмена</button>
        <button class="mbtn primary" data-confirm>Подтвердить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  elIc = overlay.querySelector("[data-ic]")!;
  elTitle = overlay.querySelector("[data-title]")!;
  elBody = overlay.querySelector("[data-body]")!;
  elConfirm = overlay.querySelector("[data-confirm]")!;
  elCancel = overlay.querySelector("[data-cancel]")!;

  elCancel.addEventListener("click", closeModal);
  elConfirm.addEventListener("click", () => { const fn = pending; closeModal(); if (fn) fn(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
  });
}

export function openModal(cfg: ModalConfig): void {
  pending = cfg.onConfirm ?? null;
  elTitle.textContent = cfg.title;
  elIc.className = "m-ic " + (cfg.icon ?? "accent");
  elIc.innerHTML = cfg.glyph ?? icons.alert;
  let html = `<p>${cfg.body}</p>`;
  if (cfg.note) {
    html += `<div class="warnline ${cfg.note.kind ?? ""}">${icons.alert}<span></span></div>`;
  }
  elBody.innerHTML = html;
  if (cfg.note) elBody.querySelector(".warnline span")!.textContent = cfg.note.text;
  elConfirm.textContent = cfg.confirm ?? "Подтвердить";
  elConfirm.className = "mbtn primary " + (cfg.confirmKind ?? "");
  lastFocus = document.activeElement;
  document.body.appendChild(overlay); // поверх динамически созданных окон
  overlay.classList.add("open");
  elConfirm.focus();
}

export function closeModal(): void {
  overlay.classList.remove("open");
  pending = null;
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

export function isModalOpen(): boolean {
  return overlay.classList.contains("open");
}

/** Простой ввод строки (замена window.prompt, который не работает в WebView2). */
export function textPrompt(title: string, placeholder = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay overlay-top open";
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="m-head"><div class="m-ic accent" aria-hidden="true">${icons.gear}</div><h2>${title}</h2></div>
        <div class="m-body"><input type="text" class="txt" data-inp placeholder="${placeholder}" autocomplete="off" spellcheck="false" /></div>
        <div class="m-foot"><button class="mbtn" data-c>Отмена</button><button class="mbtn primary" data-ok>Добавить</button></div>
      </div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector<HTMLInputElement>("[data-inp]")!;
    const done = (val: string | null) => { ov.remove(); resolve(val); };
    ov.querySelector("[data-c]")!.addEventListener("click", () => done(null));
    ov.querySelector("[data-ok]")!.addEventListener("click", () => done(inp.value.trim() || null));
    ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(inp.value.trim() || null);
      else if (e.key === "Escape") done(null);
    });
    inp.focus();
  });
}