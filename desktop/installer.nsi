Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!define MUI_ICON "icons\tropa-ai.ico"
!define MUI_UNICON "icons\tropa-ai.ico"
!ifndef APP_VERSION
!define APP_VERSION "0.1.0"
!endif
!ifndef APP_OUTPUT_DIR
!define APP_OUTPUT_DIR "../release-native"
!endif
!ifndef APP_UNPACKED_DIR
!define APP_UNPACKED_DIR "../release-native/win-unpacked"
!endif
Name "Tropa AI"
OutFile "${APP_OUTPUT_DIR}/Tropa-AI-${APP_VERSION}-win-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\Agentes Comunidad"
RequestExecutionLevel user
SetCompressor zlib
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala Tropa AI para tu usuario.$\r$\n$\r$\nCerrá otras copias de la aplicación antes de continuar. Tus cuentas y datos personales no están incluidos en este instalador."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Tropa AI.exe"
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
 Delete "$DESKTOP\Agentes Comunidad.lnk"
 Delete "$SMPROGRAMS\Agentes Comunidad\Agentes Comunidad.lnk"
 Delete "$SMPROGRAMS\Agentes Comunidad\Desinstalar.lnk"
 RMDir "$SMPROGRAMS\Agentes Comunidad"
 Delete "$INSTDIR\Agentes Comunidad.exe"
 File /r "${APP_UNPACKED_DIR}/*"
 File /oname=tropa-ai.ico "icons\tropa-ai.ico"
 WriteUninstaller "$INSTDIR\Desinstalar.exe"
 CreateShortcut "$DESKTOP\Tropa AI.lnk" "$INSTDIR\Tropa AI.exe" "" "$INSTDIR\tropa-ai.ico"
 CreateDirectory "$SMPROGRAMS\Tropa AI"
 CreateShortcut "$SMPROGRAMS\Tropa AI\Tropa AI.lnk" "$INSTDIR\Tropa AI.exe" "" "$INSTDIR\tropa-ai.ico"
 CreateShortcut "$SMPROGRAMS\Tropa AI\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "DisplayName" "Tropa AI"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "DisplayVersion" "${APP_VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad" "NoRepair" 1
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 Delete "$DESKTOP\Tropa AI.lnk"
 RMDir /r "$SMPROGRAMS\Tropa AI"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentesComunidad"
 RMDir /r "$INSTDIR"
SectionEnd
