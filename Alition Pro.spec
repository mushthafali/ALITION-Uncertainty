# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('src', 'src'), ('img', 'img')],
    hiddenimports=['numpy', 'numpy.core._multiarray_umath', 'numpy.core._multiarray_tests', 'scipy', 'scipy.special._ufuncs_cxx', 'scipy.linalg.cython_blas', 'scipy.linalg.cython_lapack', 'scipy.integrate', 'scipy.interpolate', 'pandas', 'pandas._libs.tslibs.np_datetime', 'pandas._libs.tslibs.nattype', 'pandas._libs.tslibs.timedeltas', 'matplotlib', 'matplotlib.backends.backend_pdf', 'matplotlib.backends.backend_agg', 'reportlab', 'reportlab.graphics.barcode', 'reportlab.graphics.charts', 'openpyxl', 'pydantic', 'webview'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Alition',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
