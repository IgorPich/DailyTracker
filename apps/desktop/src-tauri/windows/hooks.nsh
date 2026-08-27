!macro NSIS_HOOK_PREINSTALL
  Delete "$TEMP\greekgod-sync-service.previous.exe"
  IfFileExists "$INSTDIR\greekgod-sync-service.exe" 0 greekgod_sync_preinstall_done
    IfFileExists "$INSTDIR\sync-service-lifecycle.ps1" 0 greekgod_sync_fallback_stop
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action PrepareUpdate -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "$APPDATA\com.igorpich.formlog\greekgod-v3.sqlite"'
      Pop $0
      Goto greekgod_sync_backup_old
    greekgod_sync_fallback_stop:
      nsExec::ExecToLog 'schtasks.exe /End /TN "GreekGod Sync Service"'
      Pop $0
    greekgod_sync_backup_old:
      CopyFiles /SILENT "$INSTDIR\greekgod-sync-service.exe" "$TEMP\greekgod-sync-service.previous.exe"
  greekgod_sync_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$DESKTOP\Formlog.lnk"
  CreateShortCut "$DESKTOP\GreekGod.lnk" "$INSTDIR\greekgod.exe" "" "$INSTDIR\greekgod.exe" 0
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Install -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "$APPDATA\com.igorpich.formlog\greekgod-v3.sqlite"'
  Pop $0
  StrCmp $0 "0" greekgod_sync_install_success greekgod_sync_install_failed
  greekgod_sync_install_failed:
    IfFileExists "$TEMP\greekgod-sync-service.previous.exe" 0 greekgod_sync_install_abort
      CopyFiles /SILENT "$TEMP\greekgod-sync-service.previous.exe" "$INSTDIR\greekgod-sync-service.exe"
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Install -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "$APPDATA\com.igorpich.formlog\greekgod-v3.sqlite"'
      Pop $1
    greekgod_sync_install_abort:
      Abort "Nie udało się bezpiecznie uruchomić GreekGod Sync Service. Baza danych nie została usunięta."
  greekgod_sync_install_success:
    Delete "$TEMP\greekgod-sync-service.previous.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\sync-service-lifecycle.ps1" 0 greekgod_sync_uninstall_shortcuts
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Uninstall -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "$APPDATA\com.igorpich.formlog\greekgod-v3.sqlite"'
    Pop $0
    StrCmp $0 "0" greekgod_sync_uninstall_shortcuts 0
      Abort "Nie udało się usunąć autostartu lub reguł zapory GreekGod Sync Service."
  greekgod_sync_uninstall_shortcuts:
  Delete "$DESKTOP\GreekGod.lnk"
  Delete "$DESKTOP\Formlog.lnk"
!macroend
