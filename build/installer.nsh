!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var GitUiCreateDesktopShortcut
Var GitUiDesktopShortcutCheckbox

!macro customInit
  StrCpy $GitUiCreateDesktopShortcut "1"
!macroend

!macro customPageAfterChangeDir
  Function GitUiShortcutOptionsPage
    ${If} ${Silent}
    ${OrIf} ${isUpdated}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "安装选项" "选择要创建的快捷方式"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 300u 24u "选择是否在桌面创建 Git UI Pro 快捷方式。"
    Pop $0

    ${NSD_CreateCheckbox} 0u 34u 300u 20u "创建桌面快捷方式"
    Pop $GitUiDesktopShortcutCheckbox

    ${If} $GitUiCreateDesktopShortcut == "1"
      ${NSD_Check} $GitUiDesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function GitUiShortcutOptionsPageLeave
    ${NSD_GetState} $GitUiDesktopShortcutCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $GitUiCreateDesktopShortcut "1"
    ${Else}
      StrCpy $GitUiCreateDesktopShortcut "0"
    ${EndIf}
  FunctionEnd

  Page custom GitUiShortcutOptionsPage GitUiShortcutOptionsPageLeave
!macroend

!macro customInstall
  ${If} $GitUiCreateDesktopShortcut != "1"
    Delete "$newDesktopLink"
  ${EndIf}
!macroend
!endif
