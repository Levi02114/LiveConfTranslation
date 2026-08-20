!include LogicLib.nsh
!include MUI2.nsh
!include nsDialogs.nsh

LangString LocalAiPageTitle 1033 "Local AI"
LangString LocalAiPageTitle 1042 "로컬 AI"
LangString LocalAiPageTitle 1066 "AI cục bộ"
LangString LocalAiPageTitle 1054 "AI ภายในเครื่อง"
LangString LocalAiPageSubtitle 1033 "Choose the models to download during installation."
LangString LocalAiPageSubtitle 1042 "설치 중 다운로드할 모델을 선택하세요."
LangString LocalAiPageSubtitle 1066 "Chọn mô hình sẽ tải xuống trong khi cài đặt."
LangString LocalAiPageSubtitle 1054 "เลือกโมเดลที่จะดาวน์โหลดระหว่างการติดตั้ง"
LangString LocalAiEnable 1033 "Install local translation and speech recognition models"
LangString LocalAiEnable 1042 "로컬 번역 및 음성 인식 모델 설치"
LangString LocalAiEnable 1066 "Cài mô hình dịch và nhận dạng giọng nói cục bộ"
LangString LocalAiEnable 1054 "ติดตั้งโมเดลแปลและรู้จำเสียงภายในเครื่อง"
LangString LocalAiTranslation 1033 "Translation model"
LangString LocalAiTranslation 1042 "번역 모델"
LangString LocalAiTranslation 1066 "Mô hình dịch"
LangString LocalAiTranslation 1054 "โมเดลแปล"
LangString LocalAiTranscription 1033 "Speech recognition model"
LangString LocalAiTranscription 1042 "음성 인식 모델"
LangString LocalAiTranscription 1066 "Mô hình nhận dạng giọng nói"
LangString LocalAiTranscription 1054 "โมเดลรู้จำเสียง"
LangString LocalAiTerms 1033 "I have read and agree to the Gemma Terms of Use"
LangString LocalAiTerms 1042 "Gemma 사용 조건을 읽고 동의합니다"
LangString LocalAiTerms 1066 "Tôi đã đọc và đồng ý với Điều khoản sử dụng Gemma"
LangString LocalAiTerms 1054 "ฉันได้อ่านและยอมรับข้อกำหนดการใช้ Gemma"
LangString LocalAiOpenTerms 1033 "Open Gemma Terms"
LangString LocalAiOpenTerms 1042 "Gemma 사용 조건 열기"
LangString LocalAiOpenTerms 1066 "Mở Điều khoản Gemma"
LangString LocalAiOpenTerms 1054 "เปิดข้อกำหนด Gemma"
LangString LocalAiTermsRequired 1033 "You must agree to the Gemma Terms to install Local AI."
LangString LocalAiTermsRequired 1042 "로컬 AI를 설치하려면 Gemma 사용 조건에 동의해야 합니다."
LangString LocalAiTermsRequired 1066 "Bạn phải đồng ý với Điều khoản Gemma để cài AI cục bộ."
LangString LocalAiTermsRequired 1054 "ต้องยอมรับข้อกำหนด Gemma เพื่อติดตั้ง AI ภายในเครื่อง"
LangString LocalAiDesktopShortcut 1033 "Create a desktop shortcut"
LangString LocalAiDesktopShortcut 1042 "바탕 화면 바로가기 만들기"
LangString LocalAiDesktopShortcut 1066 "Tạo lối tắt trên màn hình nền"
LangString LocalAiDesktopShortcut 1054 "สร้างทางลัดบนเดสก์ท็อป"
LangString LocalAiInstalling 1033 "Downloading and verifying Local AI models..."
LangString LocalAiInstalling 1042 "로컬 AI 모델을 다운로드하고 검증하는 중..."
LangString LocalAiInstalling 1066 "Đang tải xuống và xác minh mô hình AI cục bộ..."
LangString LocalAiInstalling 1054 "กำลังดาวน์โหลดและตรวจสอบโมเดล AI ภายในเครื่อง..."
LangString LocalAiInstallingDetail 1033 "Keep this installer open. Large models can take a long time."
LangString LocalAiInstallingDetail 1042 "설치 프로그램을 닫지 마세요. 큰 모델은 오래 걸릴 수 있습니다."
LangString LocalAiInstallingDetail 1066 "Không đóng trình cài đặt. Mô hình lớn có thể mất nhiều thời gian."
LangString LocalAiInstallingDetail 1054 "อย่าปิดตัวติดตั้ง โมเดลขนาดใหญ่อาจใช้เวลานาน"
LangString LocalAiInstallFailed 1033 "Local AI installation failed."
LangString LocalAiInstallFailed 1042 "로컬 AI 설치에 실패했습니다."
LangString LocalAiInstallFailed 1066 "Cài đặt AI cục bộ thất bại."
LangString LocalAiInstallFailed 1054 "ติดตั้ง AI ภายในเครื่องไม่สำเร็จ"

!ifndef BUILD_UNINSTALLER
Var LocalAiInitialized
Var LocalAiEnabled
Var LocalAiEnabledControl
Var LocalAiTranslationModel
Var LocalAiTranslationControl
Var LocalAiTranscriptionModel
Var LocalAiTranscriptionControl
Var LocalAiTermsAccepted
Var LocalAiTermsControl
Var LocalAiDesktopShortcut
Var LocalAiDesktopShortcutControl

!macro customInit
  StrCpy $LocalAiTranslationModel "4b"
  StrCpy $LocalAiTranscriptionModel "small"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$os=Get-CimInstance Win32_OperatingSystem; $$r=[int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory; $$f=[int64]$$os.FreePhysicalMemory*1024; $$v=[int64]((Get-CimInstance Win32_VideoController | Measure-Object AdapterRAM -Maximum).Maximum); if (($$v -ge 21474836480 -and $$r -ge 34359738368) -or ($$r -ge 42949672960 -and $$f -ge 25769803776)) { exit 3 }; if (($$v -ge 10737418240 -and $$r -ge 17179869184) -or ($$r -ge 21474836480 -and $$f -ge 10737418240)) { exit 2 }; if ($$r -ge 17179869184 -and $$f -ge 6442450944) { exit 1 }; exit 0"'
  Pop $0
  Pop $1
  ${If} $0 == 3
    StrCpy $LocalAiTranslationModel "27b"
    StrCpy $LocalAiTranscriptionModel "medium"
  ${ElseIf} $0 == 2
    StrCpy $LocalAiTranslationModel "12b"
    StrCpy $LocalAiTranscriptionModel "medium"
  ${ElseIf} $0 == 1
    StrCpy $LocalAiTranscriptionModel "medium"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom LocalAiModelsPageCreate LocalAiModelsPageLeave
!macroend

Function LocalAiModelsPageCreate
  ${If} $LocalAiInitialized == ""
    StrCpy $LocalAiEnabled ${BST_CHECKED}
    StrCpy $LocalAiTermsAccepted ${BST_UNCHECKED}
    StrCpy $LocalAiDesktopShortcut ${BST_UNCHECKED}
    StrCpy $LocalAiInitialized "1"
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$(LocalAiPageTitle)" "$(LocalAiPageSubtitle)"
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateCheckbox} 0u 0u 100% 18u "$(LocalAiEnable)"
  Pop $LocalAiEnabledControl
  ${NSD_SetState} $LocalAiEnabledControl $LocalAiEnabled

  ${NSD_CreateLabel} 0u 30u 100% 12u "$(LocalAiTranslation)"
  Pop $0
  ${NSD_CreateDropList} 0u 45u 100% 90u ""
  Pop $LocalAiTranslationControl
  ${NSD_CB_AddString} $LocalAiTranslationControl "TranslateGemma 4B Q4_K_M · 2.5 GB"
  ${NSD_CB_AddString} $LocalAiTranslationControl "TranslateGemma 12B Q4_K_M · 7.3 GB"
  ${NSD_CB_AddString} $LocalAiTranslationControl "TranslateGemma 27B Q4_K_M · 16.5 GB"
  ${If} $LocalAiTranslationModel == "27b"
    ${NSD_CB_SetSelectionIndex} $LocalAiTranslationControl 2
  ${ElseIf} $LocalAiTranslationModel == "12b"
    ${NSD_CB_SetSelectionIndex} $LocalAiTranslationControl 1
  ${Else}
    ${NSD_CB_SetSelectionIndex} $LocalAiTranslationControl 0
  ${EndIf}

  ${NSD_CreateLabel} 0u 72u 100% 12u "$(LocalAiTranscription)"
  Pop $0
  ${NSD_CreateDropList} 0u 87u 100% 70u ""
  Pop $LocalAiTranscriptionControl
  ${NSD_CB_AddString} $LocalAiTranscriptionControl "Whisper small · 488 MB"
  ${NSD_CB_AddString} $LocalAiTranscriptionControl "Whisper medium · 1.5 GB"
  ${If} $LocalAiTranscriptionModel == "medium"
    ${NSD_CB_SetSelectionIndex} $LocalAiTranscriptionControl 1
  ${Else}
    ${NSD_CB_SetSelectionIndex} $LocalAiTranscriptionControl 0
  ${EndIf}

  ${NSD_CreateCheckbox} 0u 120u 100% 18u "$(LocalAiTerms)"
  Pop $LocalAiTermsControl
  ${NSD_SetState} $LocalAiTermsControl $LocalAiTermsAccepted
  ${NSD_CreateLink} 0u 144u 100% 14u "$(LocalAiOpenTerms)"
  Pop $0
  ${NSD_OnClick} $0 LocalAiOpenTerms
  ${NSD_CreateCheckbox} 0u 162u 100% 18u "$(LocalAiDesktopShortcut)"
  Pop $LocalAiDesktopShortcutControl
  ${NSD_SetState} $LocalAiDesktopShortcutControl $LocalAiDesktopShortcut

  nsDialogs::Show
FunctionEnd

Function LocalAiOpenTerms
  ExecShell "open" "https://ai.google.dev/gemma/terms"
FunctionEnd

Function LocalAiModelsPageLeave
  ${NSD_GetState} $LocalAiEnabledControl $LocalAiEnabled
  ${NSD_GetState} $LocalAiTermsControl $LocalAiTermsAccepted
  ${NSD_GetState} $LocalAiDesktopShortcutControl $LocalAiDesktopShortcut
  ${If} $LocalAiEnabled == ${BST_CHECKED}
  ${AndIf} $LocalAiTermsAccepted != ${BST_CHECKED}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(LocalAiTermsRequired)"
    Abort
  ${EndIf}
  ${NSD_CB_GetSelectionIndex} $LocalAiTranslationControl $0
  ${If} $0 == 2
    StrCpy $LocalAiTranslationModel "27b"
  ${ElseIf} $0 == 1
    StrCpy $LocalAiTranslationModel "12b"
  ${Else}
    StrCpy $LocalAiTranslationModel "4b"
  ${EndIf}
  ${NSD_CB_GetSelectionIndex} $LocalAiTranscriptionControl $0
  ${If} $0 == 1
    StrCpy $LocalAiTranscriptionModel "medium"
  ${Else}
    StrCpy $LocalAiTranscriptionModel "small"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $LocalAiEnabled == ${BST_CHECKED}
    ${If} $installMode == "all"
      StrCpy $3 "$APPDATA\LiveConfTranslation\local-ai"
    ${Else}
      StrCpy $3 "$LOCALAPPDATA\LiveConfTranslation\local-ai"
    ${EndIf}
    StrCpy $4 "$TEMP\LiveConfTranslation"
    FileOpen $0 "$PLUGINSDIR\local-ai-request.conf" w
    FileWrite $0 "translation=$LocalAiTranslationModel$\r$\n"
    FileWrite $0 "transcription=$LocalAiTranscriptionModel$\r$\n"
    FileWrite $0 "modelDir=$3$\r$\n"
    FileWrite $0 "tempDir=$4$\r$\n"
    FileWrite $0 "output=$INSTDIR\resources\local-ai-install.conf$\r$\n"
    FileClose $0
    Delete "$PLUGINSDIR\local-ai-error.txt"
    DetailPrint "$(LocalAiInstalling)"
    Banner::show /NOUNLOAD "$(LocalAiInstalling)" "$(LocalAiInstallingDetail)"
    ExecWait '"$appExe" --install-local-ai "$PLUGINSDIR\local-ai-request.conf" "$PLUGINSDIR\local-ai-error.txt"' $0
    Banner::destroy
    ${If} $0 != 0
      StrCpy $1 ""
      ${If} ${FileExists} "$PLUGINSDIR\local-ai-error.txt"
        FileOpen $2 "$PLUGINSDIR\local-ai-error.txt" r
        FileRead $2 $1
        FileClose $2
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "$(LocalAiInstallFailed)$\r$\n$1"
      Abort
    ${EndIf}
  ${EndIf}
  ${If} $LocalAiDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe"
  ${EndIf}
!macroend
!endif
