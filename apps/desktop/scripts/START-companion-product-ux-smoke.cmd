@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-companion-product-ux-smoke.ps1" %*
pause
