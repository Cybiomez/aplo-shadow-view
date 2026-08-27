// Всплывающие уведомления. Появляются снизу по центру, сами гаснут.
import { icons } from "./icons";

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message: string, kind: "ok" | "err" = "ok"): void {
  const t = document.createElement("div");
  t.className = "toast" + (kind === "err" ? " err" : "");
  t.innerHTML = (kind === "err" ? icons.alert : icons.check) + `<span></span>`;
  t.querySelector("span")!.textContent = message;
  ensureHost().appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s ease";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 2800);
}
