"""
Точка входа AploShadowView: окно вебвью с интерфейсом.

Запуск:  python -m backend.app   (из корня репозитория)
Перед запуском нужен собранный UI:  cd frontend && npm run build

Это администраторская утилита по требованию — обычное окно, без трея.
Геометрия окна (размер, позиция, максимизация/полный экран) запоминается между
запусками, чтобы окно вставало так, как его оставили.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .api import Api
from .config import Config

DEFAULT_W, DEFAULT_H = 780, 620
MIN_W, MIN_H = 560, 480


def resolve_ui_index() -> str:
    """Найти собранный index.html (и в разработке, и в собранном бинарнике)."""
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)  # каталог распаковки PyInstaller
    if meipass:
        candidates.append(Path(meipass) / "frontend" / "dist" / "index.html")
    here = Path(__file__).resolve().parent
    candidates.append(here.parent / "frontend" / "dist" / "index.html")
    for path in candidates:
        if path.is_file():
            return str(path)
    raise FileNotFoundError(
        "Не найден собранный UI (frontend/dist/index.html). "
        "Соберите: cd frontend && npm install && npm run build"
    )


def _sane_position(state: dict) -> dict:
    """Отбросить заведомо мусорные координаты (свёрнутое окно даёт -32000)."""
    x, y = state.get("x"), state.get("y")
    if x is None or y is None or x < -10000 or y < -10000:
        state.pop("x", None)
        state.pop("y", None)
    return state


def main() -> None:
    try:
        import webview
    except ImportError as e:
        print(
            "Не установлена зависимость UI. Установите: pip install -r backend/requirements.txt\n"
            f"Детали: {e}",
            file=sys.stderr,
        )
        raise SystemExit(1)

    config = Config()
    api = Api(config)

    state = _sane_position(config.window_state)
    kwargs = {
        "width": int(state.get("width", DEFAULT_W)),
        "height": int(state.get("height", DEFAULT_H)),
        "min_size": (MIN_W, MIN_H),
        "fullscreen": bool(state.get("fullscreen", False)),
    }
    if "x" in state and "y" in state:
        kwargs["x"] = int(state["x"])
        kwargs["y"] = int(state["y"])

    window = webview.create_window("AploShadowView", resolve_ui_index(), js_api=api, **kwargs)

    _wire_geometry(window, config, restore_maximized=bool(state.get("maximized", False)))

    webview.start()


def _wire_geometry(window, config: Config, restore_maximized: bool) -> None:
    """Подписаться на изменения окна и сохранять геометрию. Всё под guard —
    набор событий у pywebview зависит от версии и платформы."""

    def on_resized(width, height):
        config.update_window(width=int(width), height=int(height))

    def on_moved(x, y):
        config.update_window(x=int(x), y=int(y))

    def on_maximized():
        config.update_window(maximized=True)

    def on_restored():
        config.update_window(maximized=False)

    def on_shown():
        if restore_maximized:
            try:
                window.maximize()
            except Exception:
                pass

    for event_name, handler in (
        ("resized", on_resized),
        ("moved", on_moved),
        ("maximized", on_maximized),
        ("restored", on_restored),
        ("shown", on_shown),
    ):
        try:
            event = getattr(window.events, event_name)
            event += handler  # pywebview Event.__iadd__ мутирует объект на месте
        except Exception:
            pass  # событие недоступно в этой версии/платформе


if __name__ == "__main__":
    main()
