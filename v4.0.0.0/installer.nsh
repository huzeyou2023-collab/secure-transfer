!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
; 入栈：版本A、版本B（形如 4.0.0）；出栈：1 新>旧, 0 相等, -1 新<旧
Function VersionCompare
  Exch $R1
  Exch 1
  Exch $R0
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  StrCpy $R2 0
  StrCpy $R3 0
  StrCpy $R7 0
  vcMain:
    StrCpy $R4 ""
    StrCpy $R5 ""
    vcSegA:
      StrCpy $R6 $R0 1 $R2
      StrCmp $R6 "." vcSegAEnd
      StrCmp $R6 "" vcSegAEnd
      StrCpy $R4 "$R4$R6"
      IntOp $R2 $R2 + 1
      Goto vcSegA
    vcSegAEnd:
      StrCmp $R6 "." 0 vcNoDotA
        IntOp $R2 $R2 + 1
    vcNoDotA:
    vcSegB:
      StrCpy $R8 $R1 1 $R3
      StrCmp $R8 "." vcSegBEnd
      StrCmp $R8 "" vcSegBEnd
      StrCpy $R5 "$R5$R8"
      IntOp $R3 $R3 + 1
      Goto vcSegB
    vcSegBEnd:
      StrCmp $R8 "." 0 vcNoDotB
        IntOp $R3 $R3 + 1
    vcNoDotB:
      StrCmp $R4 "" 0 vcCmp
      StrCmp $R5 "" vcDone
    vcCmp:
      IntCmp $R4 $R5 vcBLess vcEq vcAGreater
    vcAGreater:
      StrCpy $R7 1
      Goto vcDone
    vcBLess:
      StrCpy $R7 -1
      Goto vcDone
    vcEq:
      Goto vcMain
  vcDone:
  StrCpy $R0 $R7
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch 1
  Pop $R0
FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
Var ExistingVer
Var VerCmp
!endif

; 安装前：版本检测（禁止降级）、覆盖安装、结束运行中的进程
!macro customInit
  SetShellVarContext all
  StrCpy $ExistingVer ""
  ReadRegStr $ExistingVer HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  StrCmp $ExistingVer "" 0 vcCheck
  ReadRegStr $ExistingVer HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  StrCmp $ExistingVer "" 0 vcCheck
  SetShellVarContext current
  ReadRegStr $ExistingVer HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  SetShellVarContext all
  vcCheck:
    StrCmp $ExistingVer "" vcNoOld
    Push $ExistingVer
    Push "${VERSION}"
    Call VersionCompare
    Pop $VerCmp
    ${If} $VerCmp == 1
      MessageBox MB_OK|MB_ICONSTOP "已安装的安全传输版本 $ExistingVer 高于当前安装包版本 ${VERSION}，禁止降级安装。请先在「控制面板 - 程序和功能」中卸载旧版本。"
      Abort
    ${EndIf}
  vcNoOld:
    nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_FILENAME}.exe" /T'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "SecureTransfer-便携版.exe" /T'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版.exe" /T'
    Pop $0
!macroend

; 卸载：确认、结束进程、彻底删除程序之外的全部用户数据
!macro customUnInstall
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "确认卸载安全传输？本机联系人、消息记录、传输缓存与「下载\安全传输」中的已接收文件将一并彻底删除。" IDOK +2
  Abort
  nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_FILENAME}.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "SecureTransfer-便携版.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版.exe" /T'
  Pop $0
  SetShellVarContext all
  RMDir /r "$LOCALAPPDATA\${PRODUCT_FILENAME}"
  RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
  RMDir /r "$LOCALAPPDATA\安全传输"
  RMDir /r "$APPDATA\安全传输"
  RMDir /r "$PROFILE\Downloads\安全传输"
  SetShellVarContext current
  RMDir /r "$LOCALAPPDATA\${PRODUCT_FILENAME}"
  RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
  RMDir /r "$LOCALAPPDATA\安全传输"
  RMDir /r "$APPDATA\安全传输"
  RMDir /r "$PROFILE\Downloads\安全传输"
  Delete "$DESKTOP\安全传输.lnk"
  Delete "$SMPROGRAMS\安全传输.lnk"
  RMDir /r "$SMPROGRAMS\安全传输"
!macroend
