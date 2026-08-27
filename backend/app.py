"""
Точка входа AploShadowView: окно вебвью с интерфейсом.

Запуск:  python -m backend.app   (из корня репозитория)
Перед запуском нужен собранный UI:  cd frontend && npm run build

Это администраторская утилита по требованию — обычное окно, без трея.
Закрытие окна завершает приложение.
"""

from __future__ import annotations

import sys
from pathlib import Path

from .api import Api
from .config import Config

WINDOW_W, WINDOW_H = 780, 620


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
    webview.create_window(
        "AploShadowView",
        resolve_ui_index(),
        js_api=api,
        width=WINDOW_W,
        height=WINDOW_H,
        min_size=(560, 480),
    )
    webview.start()


if __name__ == "__main__":
    main()
