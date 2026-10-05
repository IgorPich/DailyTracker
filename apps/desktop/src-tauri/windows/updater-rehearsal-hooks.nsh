!define UPDATER_REHEARSAL_TASK "GreekGod Updater Rehearsal Sync Service"
!define UPDATER_REHEARSAL_DATABASE "$APPDATA\com.igorpich.formlog.updater-rehearsal\greekgod-v3.sqlite"
!define UPDATER_REHEARSAL_BACKUP "$TEMP\greekgod-updater-rehearsal-sync-service.previous.exe"

!macro NSIS_HOOK_PREINSTALL
  Delete "${UPDATER_REHEARSAL_BACKUP}"
  IfFileExists "$INSTDIR\greekgod-sync-service.exe" 0 updater_rehearsal_preinstall_done
    IfFileExists "$INSTDIR\sync-service-lifecycle.ps1" 0 updater_rehearsal_fallback_stop
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action PrepareUpdate -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "${UPDATER_REHEARSAL_DATABASE}" -TaskName "${UPDATER_REHEARSAL_TASK}" -FirewallRulePrefix "${UPDATER_REHEARSAL_TASK}"'
      Pop $0
      Goto updater_rehearsal_backup_old
    updater_rehearsal_fallback_stop:
      nsExec::ExecToLog 'schtasks.exe /End /TN "${UPDATER_REHEARSAL_TASK}"'
      Pop $0
    updater_rehearsal_backup_old:
      CopyFiles /SILENT "$INSTDIR\greekgod-sync-service.exe" "${UPDATER_REHEARSAL_BACKUP}"
  updater_rehearsal_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\GreekGod Updater Rehearsal.lnk" "$INSTDIR\greekgod.exe" "" "$INSTDIR\greekgod.exe" 0
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Install -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "${UPDATER_REHEARSAL_DATABASE}" -TaskName "${UPDATER_REHEARSAL_TASK}" -FirewallRulePrefix "${UPDATER_REHEARSAL_TASK}"'
  Pop $0
  StrCmp $0 "0" updater_rehearsal_install_success updater_rehearsal_install_failed
  updater_rehearsal_install_failed:
    IfFileExists "${UPDATER_REHEARSAL_BACKUP}" 0 updater_rehearsal_install_abort
      CopyFiles /SILENT "${UPDATER_REHEARSAL_BACKUP}" "$INSTDIR\greekgod-sync-service.exe"
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Install -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "${UPDATER_REHEARSAL_DATABASE}" -TaskName "${UPDATER_REHEARSAL_TASK}" -FirewallRulePrefix "${UPDATER_REHEARSAL_TASK}"'
      Pop $1
    updater_rehearsal_install_abort:
      Abort "Updater rehearsal sync service could not start. Its isolated database was not removed."
  updater_rehearsal_install_success:
    Delete "${UPDATER_REHEARSAL_BACKUP}"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\sync-service-lifecycle.ps1" 0 updater_rehearsal_uninstall_shortcut
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sync-service-lifecycle.ps1" -Action Uninstall -ServiceExecutable "$INSTDIR\greekgod-sync-service.exe" -DatabasePath "${UPDATER_REHEARSAL_DATABASE}" -TaskName "${UPDATER_REHEARSAL_TASK}" -FirewallRulePrefix "${UPDATER_REHEARSAL_TASK}"'
    Pop $0
    StrCmp $0 "0" updater_rehearsal_uninstall_shortcut 0
      Abort "Updater rehearsal autostart or firewall rules could not be removed."
  updater_rehearsal_uninstall_shortcut:
  Delete "$DESKTOP\GreekGod Updater Rehearsal.lnk"
!macroend
