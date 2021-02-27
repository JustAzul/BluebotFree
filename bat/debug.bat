@echo off
cd ..
echo Starting in Chrome DebugMode..
node --max-old-space-size=4096 --expose-gc --inspect=9222 azul.js
pause