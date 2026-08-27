"""
Запускной файл AploShadowView.

Тонкая обёртка: backend остаётся пакетом с относительными импортами, а точка
входа одна и та же и при `python main.py`, и при сборке PyInstaller.
"""

from backend.app import main

if __name__ == "__main__":
    main()
