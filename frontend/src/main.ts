import "./styles/main.scss";
import { bootstrap } from "./app";

// pywebview внедряет window.pywebview.api не мгновенно — по событию pywebviewready.
// Стартуем строго после его готовности, иначе первый вызов моста уйдёт в мок.
// В браузере (dev) объекта pywebview нет вовсе — стартуем с мок-данными.

let started = false;
function start(): void {
  if (started) return;
  started = true;
  bootstrap();
}

const w = window as any;

if (w.pywebview?.api) {
  // api уже готов
  start();
} else {
  window.addEventListener("pywebviewready", start, { once: true });
  if (w.pywebview) {
    // мы в окне вебвью, но api ещё не пришёл — подстраховка, если событие упустили
    setTimeout(() => { if (w.pywebview?.api) start(); }, 4000);
  } else {
    // браузерный dev: pywebview отсутствует — стартуем с мок-мостом
    setTimeout(start, 300);
  }
}
