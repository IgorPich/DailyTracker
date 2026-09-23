@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Record-ManualResult.ps1" -Kind TrackerLaunch -Result PASS
pause
