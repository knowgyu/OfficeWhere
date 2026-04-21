# -*- mode: python ; coding: utf-8 -*-
# office-data-joiner PyInstaller spec 파일
# --onedir 방식 사용 (onefile은 바이러스 오진 이슈 있음)

import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

# frontend/dist 경로
frontend_dist = str(Path('frontend') / 'dist')
backend_modules = collect_submodules('backend')

a = Analysis(
    ['launcher.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        (frontend_dist, 'frontend/dist'),
    ],
    hiddenimports=backend_modules + [
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'pandas',
        'pandas._libs.tslibs.timedeltas',
        'pandas._libs.tslibs.np_datetime',
        'pandas._libs.tslibs.nattype',
        'openpyxl',
        'openpyxl.cell._writer',
        'rapidfuzz',
        'docx',
        'pptx',
        'xlrd',
        'aiosqlite',
        'fastapi',
        'starlette',
        'pydantic',
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='office-data-joiner',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 오류 확인을 위해 콘솔 창 표시
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='office-data-joiner',
)
