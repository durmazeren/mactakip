@echo off
setlocal
title Mac Takip
cd /d "%~dp0"

REM ---------- 1) Node.js ----------
where node >nul 2>nul
if not errorlevel 1 goto :haveNode
if exist "%ProgramFiles%\nodejs\node.exe" goto :addNodePath

echo Node.js bulunamadi. Uygulamanin calismasi icin gerekli.
choice /C EH /M "Node.js otomatik kurulsun mu (E=Evet, H=Hayir)"
if errorlevel 2 goto :manualNode

where winget >nul 2>nul
if errorlevel 1 goto :manualNode
echo.
echo Node.js kuruluyor... Yonetici izni sorarsa "Evet" de.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if not exist "%ProgramFiles%\nodejs\node.exe" goto :manualNode

:addNodePath
set "PATH=%ProgramFiles%\nodejs;%PATH%"
goto :haveNode

:manualNode
echo.
echo Node.js'i https://nodejs.org adresinden (LTS) kurup bu dosyaya tekrar cift tikla.
start "" "https://nodejs.org"
pause
exit /b 1

REM ---------- 2) Uygulama dosyalari ----------
:haveNode
if exist "node_modules\electron\package.json" goto :haveModules
echo.
echo Ilk calistirma: gerekli dosyalar indiriliyor (1-2 dk)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

REM ---------- 3) Electron (ilk calistirmada ayrica indirilir) ----------
:haveModules
if exist "node_modules\electron\dist\electron.exe" goto :run
echo.
echo Electron indiriliyor...
node "node_modules\electron\install.js"
if errorlevel 1 goto :fail
if not exist "node_modules\electron\dist\electron.exe" goto :fail

:run
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:fail
echo.
echo Kurulum basarisiz oldu. Internet baglantini kontrol edip tekrar dene.
echo Sorun devam ederse "node_modules" klasorunu silip bu dosyayi tekrar calistir.
pause
exit /b 1
