!macro NSIS_HOOK_POSTINSTALL
  ; Repair an existing desktop shortcut during updates without creating a new
  ; shortcut for users who previously chose not to have one.
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 yfonts_desktop_shortcut_done
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  yfonts_desktop_shortcut_done:
!macroend
