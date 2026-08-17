!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\Formlog.lnk" "$INSTDIR\formlog.exe" "" "$INSTDIR\formlog.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\Formlog.lnk"
!macroend
