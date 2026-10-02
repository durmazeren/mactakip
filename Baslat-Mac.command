#!/bin/bash
# Mac: çift tıkla -> Maç Takip açılır
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar dene."
  read -n 1 -s -r -p "Kapatmak icin bir tusa bas..."
  exit 1
fi
if [ ! -x node_modules/.bin/electron ]; then
  echo "Ilk calistirma: gerekli dosyalar indiriliyor (1-2 dk)..."
  npm install || { read -n 1 -s -r -p "Kurulum basarisiz. Kapatmak icin bir tusa bas..."; exit 1; }
fi
# Electron programı npm install ile değil ilk çalıştırmada iner; yüklüyse bu komut hemen çıkar
node node_modules/electron/install.js || { read -n 1 -s -r -p "Electron indirilemedi. Kapatmak icin bir tusa bas..."; exit 1; }
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
disown
osascript -e 'tell application "Terminal" to close (every window whose name contains "Baslat")' >/dev/null 2>&1 &
exit 0
