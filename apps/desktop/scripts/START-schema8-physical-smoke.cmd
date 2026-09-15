@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-schema8-physical-smoke.ps1"
if errorlevel 1 pause
