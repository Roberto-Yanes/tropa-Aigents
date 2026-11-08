Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "Agentes Comunidad"
OutFile "../release-native/Agentes-Comunidad-0.1.0-win-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Agentes Comunidad"
RequestExecutionLevel user
SetCompressor zlib
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala Agentes Comunidad para tu usuario.$\r$\n$\r$\nCerrá otras copias de la aplicación antes de continuar. Tus cuentas y datos personales no están incluidos en este instalador."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Agentes Comunidad.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "Esta versión requiere Windows de 64 bits."
  Abort
 ${EndIf}
FunctionEnd
Section "Instalar"
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r "../release-native/win-unpacked/*"
 WriteUninstaller "$INSTDIR\Desinstalar.exe"
 CreateShortcut "$DESKTOP\Agentes Comunidad.lnk" "$INSTDIR\Agentes Comunidad.exe"
 CreateDirectory "$SMPROGRAMS\Agentes Comunidad"
 CreateShortcut "$SMPROGRAMS\Agentes Comunidad\Agentes Comunidad.lnk" "$INSTDIR\Agentes Comunidad.exe"
 CreateShortcut "$SMPROGRAMS\Agentes Comunidad\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "DisplayName" "Agentes Comunidad"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "DisplayVersion" "0.1.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "NoRepair" 1
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 Delete "$DESKTOP\Agentes Comunidad.lnk"
 RMDir /r "$SMPROGRAMS\Agentes Comunidad"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad"
 RMDir /r "$INSTDIR"
SectionEnd
