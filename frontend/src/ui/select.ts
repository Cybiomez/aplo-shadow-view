// Кастомный выпадающий список. Меню рендерится ПОВЕРХ всего (portal в body,
// position: fixed от триггера) — не двигает вёрстку, не обрезается попапом.
// Клик по меню не закрывает родительское окно (меню вне оверлея формы).
import { icons } from "./icons";

let openMenu: HTMLElement | null = null;

document.addEventListener("click", closeAll);
window.addEventListener("resize", closeAll);
window.addEventListener("scroll", closeAll, true);

function closeAll(): void {
  if (openMenu) {
    openMenu.classList.remove("open");
    openMenu.remove();
    openMenu = null;
  }
}

/** Превратить все <select> внутри root в кастомные списки. */
export function enhanceSelects(root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>("select").forEach((sel) => {
    if (sel.dataset.enhanced) return;
    sel.dataset.enhanced = "1";

    const wrap = document.createElement("div");
    wrap.className = "csel";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "csel-trigger";

    const updateTrigger = () => {
      const cur = sel.options[sel.selectedIndex];
      trigger.innerHTML = `<span>${cur ? cur.textContent : ""}</span>${icons.arrowDown}`;
    };

    const openThis = () => {
      closeAll();
      const menu = document.createElement("div");
      menu.className = "csel-menu open";
      Array.from(sel.options).forEach((opt) => {
        const item = document.createElement("div");
        item.className = "csel-opt" + (opt.value === sel.value ? " on" : "");
        item.textContent = opt.textContent;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          updateTrigger();
          closeAll();
        });
        menu.appendChild(item);
      });
      menu.addEventListener("click", (e) => e.stopPropagation()); // клик по меню не закрывает окно
      document.body.appendChild(menu);
      const r = trigger.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.left = `${r.left}px`;
      menu.style.width = `${r.width}px`;
      // раскрыть вниз, а если не влезает — вверх
      const below = window.innerHeight - r.bottom;
      if (below < 220 && r.top > below) {
        menu.style.bottom = `${window.innerHeight - r.top + 4}px`;
      } else {
        menu.style.top = `${r.bottom + 4}px`;
      }
      openMenu = menu;
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenu) closeAll();
      else openThis();
    });
    sel.addEventListener("change", updateTrigger);

    sel.parentNode!.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(trigger);
    updateTrigger();
  });
}
