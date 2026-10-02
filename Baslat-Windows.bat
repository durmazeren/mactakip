@echo off
REM Windows: cift tikla -> Mac Takip acilir
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi.
  echo https://nodejs.org adresinden LTS surumunu kur, sonra bu dosyaya tekrar cift tikla.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Ilk calistirma: gerekli dosyalar indiriliyor ^(1-2 dk^)...
  if exist node_modules rmdir /s /q node_modules
  call npm install
  if errorlevel 1 (
    echo Kurulum basarisiz. Internet baglantini kontrol edip tekrar dene.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
