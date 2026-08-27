import "./styles/main.scss";
import { bootstrap } from "./app";

// pywebview прокидывает api не мгновенно: если его ещё нет — ждём событие
// pywebviewready, иначе (браузерный dev) стартуем сразу с мок-мостом.
function start(): void { bootstrap(); }

if ((window as any).pywebview?.api) {
  start();
} else {
  let started = false;
  const go = () => { if (!started) { started = true; start(); } };
  window.addEventListener("pywebviewready", go);
  // запасной старт для браузера, где события pywebviewready не будет
  setTimeout(go, 300);
}
