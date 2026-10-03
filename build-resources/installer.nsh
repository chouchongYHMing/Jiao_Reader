; Keep the assisted directory picker, but install only for the current user.
; The default NSIS template creates the shortcuts and Windows uninstall entry.
!macro customInstallMode
  StrCpy $isForceMachineInstall "0"
  StrCpy $isForceCurrentInstall "1"
!macroend
