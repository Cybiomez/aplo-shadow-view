# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller-спека: собирает AploShadowView в один переносимый файл (без установки).
# Запуск из корня репозитория:  pyinstaller build/aplo-shadow-view.spec
# Перед сборкой нужен собранный UI:  cd frontend && npm run build
#
# Пути PyInstaller разрешает относительно каталога спеки (build/), поэтому до
# корня репозитория поднимаемся через "..".

a = Analysis(
    ["../main.py"],
    pathex=[".."],
    binaries=[],
    # Собранный фронтенд кладём внутрь бинарника; app.py находит его через _MEIPASS.
    datas=[
        ("../frontend/dist", "frontend/dist"),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AploShadowView",
    # icon="../backend/assets/icon.ico",  # добавить, когда появится иконка
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # десктоп-окно без консоли
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    uac_admin=True,         # запрашивать права администратора (нужно для реестра/задания/RDS)
)
