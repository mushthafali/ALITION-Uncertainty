@echo off
echo ========================================================
echo Memulai Proses Build 'Alition' (Mode: One File)
echo ========================================================
echo.
echo [1/3] Memeriksa instalasi PyInstaller...
pip install pyinstaller

echo.
echo [2/3] Menghapus folder build lama (jika ada)...
if exist build rmdir /s /q build
if exist "dist\Alition.exe" del /q "dist\Alition.exe"

echo.
echo [3/3] Menjalankan PyInstaller dengan semua hidden imports...
pyinstaller ^
    --name "Alition" ^
    --noconfirm ^
    --onefile ^
    --windowed ^
    --add-data "src;src" ^
    --add-data "img;img" ^
    --hidden-import numpy ^
    --hidden-import numpy.core._multiarray_umath ^
    --hidden-import numpy.core._multiarray_tests ^
    --hidden-import scipy ^
    --hidden-import scipy.special._ufuncs_cxx ^
    --hidden-import scipy.linalg.cython_blas ^
    --hidden-import scipy.linalg.cython_lapack ^
    --hidden-import scipy.integrate ^
    --hidden-import scipy.interpolate ^
    --hidden-import pandas ^
    --hidden-import pandas._libs.tslibs.np_datetime ^
    --hidden-import pandas._libs.tslibs.nattype ^
    --hidden-import pandas._libs.tslibs.timedeltas ^
    --hidden-import matplotlib ^
    --hidden-import matplotlib.backends.backend_pdf ^
    --hidden-import matplotlib.backends.backend_agg ^
    --hidden-import reportlab ^
    --hidden-import reportlab.graphics.barcode ^
    --hidden-import reportlab.graphics.charts ^
    --hidden-import openpyxl ^
    --hidden-import pydantic ^
    --hidden-import webview ^
    main.py

echo.
echo ========================================================
echo BUILD SELESAI!
echo Silakan cek folder 'dist' untuk file 'Alition Pro.exe'.
echo ========================================================
pause
