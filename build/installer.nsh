; SC Companion — custom NSIS hooks (runs at installer/admin privilege)

!macro customInstall
  ; Create elevated scheduled task for KeyHook.exe.
  ; /sc onlogon lets schtasks /run trigger it on demand without a separate trigger type.
  ; /rl highest runs it at the user's highest available privilege (admin on admin accounts).
  ExecWait 'schtasks /create /tn "SCCompanionHook" /tr "$\"$INSTDIR\resources\app.asar.unpacked\KeyHook.exe$\"" /sc onlogon /rl highest /f'
!macroend

!macro customUnInstall
  ExecWait 'schtasks /end /tn "SCCompanionHook"'
  ExecWait 'schtasks /delete /tn "SCCompanionHook" /f'
!macroend
