# -*- mode: python ; coding: utf-8 -*-
# Backend-only PyInstaller spec for the Electron desktop shell.

from PyInstaller.utils.hooks import collect_submodules

backend_modules = collect_submodules('backend')

a = Analysis(
    ['backend_server.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=backend_modules + [
        # uvicorn
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
        # data
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
        # web framework
        'fastapi',
        'starlette',
        'pydantic',
        'h11',
        # async
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        'aiosqlite',
        # Windows multiprocessing and Korean filenames
        'multiprocessing',
        'multiprocessing.spawn',
        'multiprocessing.forkserver',
        'encodings',
        'encodings.utf_8',
        'encodings.cp949',
        'encodings.euc_kr',
        'encodings.aliases',
    ],
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
    [],
    exclude_binaries=True,
    name='office-data-joiner-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
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
    name='office-data-joiner-backend',
)
