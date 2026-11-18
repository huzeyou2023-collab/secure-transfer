!include LogicLib.nsh

; 默认安装目录使用中文产品名：C:\Program Files\安全传输
; （覆盖 electron-builder 命令行传入的 APP_FILENAME=SecureTransfer）
!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "安全传输"

; 自定义“应用是否在运行”检查：模板默认实现用 PowerShell 判断进程 Path 是否以 $INSTDIR 开头，
; 但 un.onInit 中调用时 $INSTDIR 尚未初始化（为空），会误判所有进程为“运行中”，
; 导致静默卸载直接 Quit（什么都不删）、覆盖安装失败。这里改为按进程名判断。
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 1000
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      nsExec::ExecToLog 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
      Pop $R1
      Sleep 800
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 == 0
        IfSilent ucpAbort 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "安全传输正在运行，请先退出应用后再继续。"
        ucpAbort:
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Var ExistingVer
Var ExistingUninst
Var VerA
Var VerB
Var VerResult
Var VerIdxA
Var VerIdxB
Var VerSegA
Var VerSegB
Var VerCh
Var VerTmp
; 版本比较：输入 $VerA（旧）与 $VerB（新），输出 $VerResult：1 新>旧, 0 相等, -1 新<旧
; 段数不限（兼容三位/四位版本号），段内只取数字，缺失段按 0 处理；不使用数据栈，避免栈失衡。
Function VersionCompare
  StrCpy $VerIdxA 0
  StrCpy $VerIdxB 0
  StrCpy $VerResult 0
  vcLoop:
    StrCpy $VerSegA ""
    vcSegA:
      StrCpy $VerCh $VerA 1 $VerIdxA
      StrCmp $VerCh "" vcSegAEnd
      StrCmp $VerCh "." vcSegADot
      ${If} $VerCh S>= "0"
      ${AndIf} $VerCh S<= "9"
        StrCpy $VerSegA "$VerSegA$VerCh"
      ${EndIf}
      IntOp $VerIdxA $VerIdxA + 1
      Goto vcSegA
    vcSegADot:
      IntOp $VerIdxA $VerIdxA + 1
    vcSegAEnd:
    StrCpy $VerSegA "0$VerSegA"
    vcStripA:
      StrCpy $VerCh $VerSegA 1
      StrCmp $VerCh "0" 0 vcSegAOk
      StrLen $VerTmp $VerSegA
      StrCmp $VerTmp 1 vcSegAOk
      StrCpy $VerSegA $VerSegA "" 1
      Goto vcStripA
    vcSegAOk:
    StrCpy $VerSegB ""
    vcSegB:
      StrCpy $VerCh $VerB 1 $VerIdxB
      StrCmp $VerCh "" vcSegBEnd
      StrCmp $VerCh "." vcSegBDot
      ${If} $VerCh S>= "0"
      ${AndIf} $VerCh S<= "9"
        StrCpy $VerSegB "$VerSegB$VerCh"
      ${EndIf}
      IntOp $VerIdxB $VerIdxB + 1
      Goto vcSegB
    vcSegBDot:
      IntOp $VerIdxB $VerIdxB + 1
    vcSegBEnd:
    StrCpy $VerSegB "0$VerSegB"
    vcStripB:
      StrCpy $VerCh $VerSegB 1
      StrCmp $VerCh "0" 0 vcSegBOk
      StrLen $VerTmp $VerSegB
      StrCmp $VerTmp 1 vcSegBOk
      StrCpy $VerSegB $VerSegB "" 1
      Goto vcStripB
    vcSegBOk:
    IntCmp $VerSegA $VerSegB vcEqSeg vcALess vcAGreater
  vcEqSeg:
    StrCpy $VerCh $VerA 1 $VerIdxA
    StrCpy $VerTmp $VerB 1 $VerIdxB
    StrCmp $VerCh "" 0 vcLoop
    StrCmp $VerTmp "" 0 vcLoop
    Goto vcDone
  vcAGreater:
    StrCpy $VerResult 1
    Goto vcDone
  vcALess:
    StrCpy $VerResult -1
  vcDone:
FunctionEnd
!endif


; 安装前：孤儿键自愈、版本检测（禁止降级）、覆盖安装、结束运行中的进程
!macro customInit
  SetShellVarContext all
  StrCpy $ExistingVer ""
  StrCpy $ExistingUninst ""
  ReadRegStr $ExistingVer HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ReadRegStr $ExistingUninst HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  StrCmp $ExistingVer "" 0 vcCheck
  ReadRegStr $ExistingVer HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ReadRegStr $ExistingUninst HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  StrCmp $ExistingVer "" 0 vcCheck
  SetShellVarContext current
  ReadRegStr $ExistingVer HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ReadRegStr $ExistingUninst HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  SetShellVarContext all
  vcCheck:
    StrCmp $ExistingVer "" vcNoOld
    StrCmp $ExistingUninst "" vcOrphan
    ; 解析 UninstallString 为纯文件路径："C:\...\Uninstall X.exe" /allusers -> C:\...\Uninstall X.exe
    StrCpy $R0 $ExistingUninst
    StrCpy $R1 $R0 1
    StrCmp $R1 '"' 0 vcNoQuote
      StrCpy $R0 $R0 "" 1
      StrCpy $R2 0
      vcFindQuote:
        StrCpy $R1 $R0 1 $R2
        StrCmp $R1 '"' vcFoundQuoteEnd
        StrCmp $R1 "" vcFoundQuoteEnd
        IntOp $R2 $R2 + 1
        Goto vcFindQuote
      vcFoundQuoteEnd:
        StrCpy $R0 $R0 $R2
      Goto vcFileCheck
    vcNoQuote:
      ; 无引号：截到第一个空格
      StrCpy $R2 0
      vcFindSpace:
        StrCpy $R1 $R0 1 $R2
        StrCmp $R1 " " vcFoundSpaceEnd
        StrCmp $R1 "" vcFoundSpaceEnd
        IntOp $R2 $R2 + 1
        Goto vcFindSpace
      vcFoundSpaceEnd:
        StrCpy $R0 $R0 $R2
      Goto vcFileCheck
    vcFileCheck:
    IfFileExists "$R0" 0 vcOrphan
    ; 旧版本存在：禁止降级
    StrCpy $VerA $ExistingVer
    StrCpy $VerB "${VERSION}"
    Call VersionCompare
    ${If} $VerResult == 1
      IfSilent vcDowngradeSilent 0
      MessageBox MB_OK|MB_ICONSTOP "已安装的安全传输版本 $ExistingVer 高于当前安装包版本 ${VERSION}，禁止降级安装。请先在「控制面板 - 程序和功能」中卸载旧版本。"
      Goto vcDowngradeAbort
      vcDowngradeSilent:
      ; 静默模式：写日志后中止，便于自动化验证降级拦截
      FileOpen $R3 "$TEMP\securetransfer-downgrade.log" w
      FileWrite $R3 "DOWNGRADE-BLOCKED: installed=$ExistingVer package=${VERSION}"
      FileClose $R3
      vcDowngradeAbort:
      Abort
    ${EndIf}
    Goto vcKillProc
  vcOrphan:
    ; 孤儿键：卸载程序已不存在，删除注册表键并视为无旧版本
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    SetShellVarContext current
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    SetShellVarContext all
  vcNoOld:
    ; 兜底：无论有无 DisplayVersion，清掉任何残留的孤儿卸载键
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    SetShellVarContext current
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    SetShellVarContext all
  vcKillProc:
    nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_FILENAME}.exe" /T'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "SecureTransfer-便携版.exe" /T'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版.exe" /T'
    Pop $0
    nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版-v${VERSION}.exe" /T'
    Pop $0
!macroend

; 安装：添加局域网发现 / 加密会话的 Windows 防火墙入站规则（仅安装版；便携版不写系统）
!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="安全传输 UDP 42813"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="安全传输 UDP 42813" dir=in action=allow protocol=UDP localport=42813 profile=private,domain'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="安全传输 TCP 42815-42824"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="安全传输 TCP 42815-42824" dir=in action=allow protocol=TCP localport=42815-42824 profile=private,domain'
  Pop $0
!macroend

; 卸载：确认（静默模式跳过）、结束进程、彻底删除程序之外的全部用户数据。
; 覆盖安装时新安装器会带 --updated 调用本卸载器，此时保留用户数据与快捷方式。
!macro customUnInstall
  IfSilent ucSkipConfirm 0
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "确认卸载安全传输？本机联系人、消息记录、传输缓存与「下载\安全传输」中的已接收文件将一并彻底删除。" IDOK ucSkipConfirm
  Abort
  ucSkipConfirm:
  ; 判断是否升级调用（带 --updated 参数）
  InitPluginsDir
  StrCpy $R0 "1"
  ClearErrors
  ${GetParameters} $R1
  ${GetOptions} $R1 "--updated" $R2
  IfErrors 0 +2
  Goto customUnInstallData
  StrCpy $R0 "0"
  customUnInstallData:
  nsExec::ExecToLog 'taskkill /F /IM "${PRODUCT_FILENAME}.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "SecureTransfer-便携版.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版.exe" /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /IM "安全传输-便携版-v${VERSION}.exe" /T'
  Pop $0
  ; 仅真实卸载删除用户数据与快捷方式
  ${If} $R0 == "1"
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
    ; 移除安装时添加的防火墙入站规则
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="安全传输 UDP 42813"'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="安全传输 TCP 42815-42824"'
    Pop $0
  ${EndIf}
!macroend

; 自定义安装目录删除：安全软件可能短暂锁定个别 DLL，失败时重试，仍失败则安排重启后删除
!macro customRemoveFiles
  SetOutPath $TEMP
  StrCpy $R1 0
  rmfLoop:
    IntOp $R1 $R1 + 1
    ClearErrors
    RMDir /r "$INSTDIR"
    IfFileExists "$INSTDIR\*.*" 0 rmfDone
    ${If} $R1 < 15
      Sleep 1500
      Goto rmfLoop
    ${EndIf}
    RMDir /r /REBOOTOK "$INSTDIR"
  rmfDone:
!macroend
