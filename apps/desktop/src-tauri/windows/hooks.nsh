!macro NSIS_HOOK_POSTINSTALL
  Delete "$DESKTOP\Formlog.lnk"
  CreateShortCut "$DESKTOP\GreekGod.lnk" "$INSTDIR\greekgod.exe" "" "$INSTDIR\greekgod.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\GreekGod.lnk"
  Delete "$DESKTOP\Formlog.lnk"
!macroend
