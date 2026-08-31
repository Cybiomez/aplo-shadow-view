// Кастомный выпадающий список: полностью стилизуемый (нативный <option> не
// поддаётся CSS в раскрытом виде). «Оборачивает» существующий <select>: логика
// и чтение .value сохраняются, меняется только внешний вид.
import { icons } from "./icons";

let openMenu: HTMLElement | null = null;

document.addEventListener("click", () => { closeAll(); });

function closeAll(): void {
  if (openMenu) { openMenu.classList.remove("open"); openMenu = null; }
}

/** Превратить все <select class="txt"> внутри root в кастомные списки. */
export function enhanceSelects(root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>("select").forEach((sel) => {
    if (sel.dataset.enhanced) return;
    sel.dataset.enhanced = "1";

    const wrap = document.createElement("div");
    wrap.className = "csel";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "csel-trigger";
    const menu = document.createElement("div");
    menu.className = "csel-menu";

    const build = () => {
      menu.innerHTML = "";
      Array.from(sel.options).forEach((opt) => {
        const item = document.createElement("div");
        item.className = "csel-opt" + (opt.value === sel.value ? " on" : "");
        item.textContent = opt.textContent;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          updateTrigger();
          build();
          closeAll();
        });
        menu.appendChild(item);
      });
    };
    const updateTrigger = () => {
      const cur = sel.options[sel.selectedIndex];
      trigger.innerHTML = `<span>${cur ? cur.textContent : ""}</span>${icons.arrowDown}`;
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains("open");
      closeAll();
      if (!wasOpen) { build(); menu.classList.add("open"); openMenu = menu; }
    });

    // если .value меняют из кода — держим триггер в синхроне
    sel.addEventListener("change", updateTrigger);

    sel.parentNode!.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    updateTrigger();
  });
}
