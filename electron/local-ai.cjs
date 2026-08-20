/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes } = require("node:crypto");
const { execFile } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statfsSync, statSync } = require("node:fs");
const { get } = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const RUNTIMES = {
  llama: {
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b10509/llama-b10509-bin-win-vulkan-x64.zip",
    sha256: "23b09fc30a7d469aced523b6479035f48af5c419d8b325df9c1383de0e36fb43",
    file: "llama-b10509-win-vulkan.zip",
    binary: "llama-server.exe",
  },
  whisper: {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
    sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
    file: "whisper-v1.9.2-win-x64.zip",
    binary: "whisper-server.exe",
  },
};

const TRANSLATION_MODELS = {
  "4b": {
    label: "TranslateGemma 4B Q4_K_M · 2.5 GB",
    url: "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf",
    sha256: "81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330",
    file: "translategemma-4b-it.Q4_K_M.gguf",
  },
  "12b": {
    label: "TranslateGemma 12B Q4_K_M · 7.3 GB",
    url: "https://huggingface.co/mradermacher/translategemma-12b-it-GGUF/resolve/main/translategemma-12b-it.Q4_K_M.gguf",
    sha256: "b7aac4b4be7ab0c49b6556c29c4467e74313df7f1e95d9f9676bb2adf0afa528",
    file: "translategemma-12b-it.Q4_K_M.gguf",
  },
  "27b": {
    label: "TranslateGemma 27B Q4_K_M · 16.5 GB",
    url: "https://huggingface.co/mradermacher/translategemma-27b-it-GGUF/resolve/main/translategemma-27b-it.Q4_K_M.gguf",
    sha256: "7f1e67c4ecfec676b38c1ea2ef85c46fafe2f02d3c050fb9540e51787405d8a3",
    file: "translategemma-27b-it.Q4_K_M.gguf",
  },
};

const TRANSCRIPTION_MODELS = {
  small: {
    label: "Whisper small · 488 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    file: "ggml-small.bin",
  },
  medium: {
    label: "Whisper medium · 1.5 GB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    sha256: "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    file: "ggml-medium.bin",
  },
};

const UI = {
  ko: {
    installedOnly: "로컬 AI는 Windows 설치형에서만 지원합니다.", translationTitle: "로컬 번역 모델", transcriptionTitle: "로컬 음성 인식 모델",
    recommended: "권장", modelNote: "큰 모델일수록 품질이 좋아지지만 메모리와 시작 시간이 늘어납니다.", cancel: "취소",
    termsTitle: "모델 사용 조건", termsMessage: "TranslateGemma와 Whisper 모델을 다운로드합니다.", termsDetail: "설치 중 인터넷 연결이 필요합니다. TranslateGemma는 Gemma 사용 조건을 따릅니다. 사용 조건을 확인하고 동의한 경우에만 계속하세요.", openTerms: "사용 조건 열기", agree: "동의하고 계속",
    modelFolder: "모델 저장 폴더", tempFolder: "임시 다운로드 폴더", noSpace: "임시 폴더의 여유 공간이 부족합니다.", need: "필요", downloadFailed: "다운로드 실패", checksumMismatch: "다운로드 파일의 SHA-256이 일치하지 않습니다", runtimeMissing: "로컬 AI 실행 파일을 찾지 못했습니다", complete: "로컬 AI 설치가 완료되었습니다.", completeDetail: "관리 페이지에서 번역 또는 음성 인식 엔진으로 Local AI를 선택할 수 있습니다.", ok: "확인", menuSetup: "로컬 AI 설치 및 모델 변경", caDownload: "휴대전화용 로컬 HTTPS 인증서 받기", running: "진행 중인 세션이 있어 로컬 AI 모델을 바꿀 수 없습니다.", runningDetail: "세션을 종료한 뒤 다시 시도해 주세요.", failed: "로컬 AI 설치 실패", promptTitle: "로컬 AI", promptMessage: "인터넷 없이 번역과 음성 인식을 사용할 모델을 설치할까요?", promptDetail: "지금 건너뛰어도 설정 메뉴에서 나중에 설치할 수 있습니다.", install: "설치", later: "나중에", desktopPrompt: "바탕 화면 바로가기를 만들까요?", createShortcut: "만들기", noShortcut: "만들지 않음",
  },
  vi: {
    installedOnly: "AI cục bộ chỉ được hỗ trợ trong bản cài đặt Windows.", translationTitle: "Mô hình dịch cục bộ", transcriptionTitle: "Mô hình nhận dạng giọng nói cục bộ",
    recommended: "Khuyên dùng", modelNote: "Mô hình lớn cho chất lượng tốt hơn nhưng cần nhiều bộ nhớ và thời gian khởi động hơn.", cancel: "Hủy",
    termsTitle: "Điều khoản sử dụng mô hình", termsMessage: "Ứng dụng sẽ tải TranslateGemma và Whisper.", termsDetail: "Cần Internet trong khi cài đặt. TranslateGemma tuân theo điều khoản Gemma. Chỉ tiếp tục sau khi bạn đã đọc và đồng ý.", openTerms: "Mở điều khoản", agree: "Đồng ý và tiếp tục",
    modelFolder: "Thư mục lưu mô hình", tempFolder: "Thư mục tải xuống tạm thời", noSpace: "Thư mục không còn đủ dung lượng.", need: "Cần", downloadFailed: "Tải xuống thất bại", checksumMismatch: "Mã SHA-256 của tệp tải xuống không khớp", runtimeMissing: "Không tìm thấy tệp chạy AI cục bộ", complete: "Đã cài đặt AI cục bộ.", completeDetail: "Bạn có thể chọn Local AI cho dịch hoặc nhận dạng giọng nói trong trang quản trị.", ok: "OK", menuSetup: "Cài đặt AI cục bộ và đổi mô hình", caDownload: "Tải chứng chỉ HTTPS cục bộ cho điện thoại", running: "Không thể đổi mô hình khi đang có phiên hoạt động.", runningDetail: "Hãy kết thúc phiên rồi thử lại.", failed: "Cài đặt AI cục bộ thất bại", promptTitle: "AI cục bộ", promptMessage: "Cài mô hình để dịch và nhận dạng giọng nói không cần Internet?", promptDetail: "Bạn có thể bỏ qua và cài sau trong menu Cài đặt.", install: "Cài đặt", later: "Để sau", desktopPrompt: "Tạo lối tắt trên màn hình nền?", createShortcut: "Tạo", noShortcut: "Không tạo",
  },
  th: {
    installedOnly: "AI ภายในเครื่องรองรับเฉพาะรุ่นติดตั้ง Windows", translationTitle: "โมเดลแปลภายในเครื่อง", transcriptionTitle: "โมเดลรู้จำเสียงภายในเครื่อง",
    recommended: "แนะนำ", modelNote: "โมเดลขนาดใหญ่มีคุณภาพดีกว่า แต่ใช้หน่วยความจำและเวลาเริ่มต้นมากขึ้น", cancel: "ยกเลิก",
    termsTitle: "ข้อกำหนดการใช้โมเดล", termsMessage: "แอปจะดาวน์โหลด TranslateGemma และ Whisper", termsDetail: "ต้องใช้อินเทอร์เน็ตระหว่างติดตั้ง TranslateGemma อยู่ภายใต้ข้อกำหนด Gemma โปรดดำเนินการต่อเมื่ออ่านและยอมรับแล้ว", openTerms: "เปิดข้อกำหนด", agree: "ยอมรับและดำเนินการต่อ",
    modelFolder: "โฟลเดอร์เก็บโมเดล", tempFolder: "โฟลเดอร์ดาวน์โหลดชั่วคราว", noSpace: "พื้นที่ว่างในโฟลเดอร์ไม่เพียงพอ", need: "ต้องการ", downloadFailed: "ดาวน์โหลดไม่สำเร็จ", checksumMismatch: "ค่า SHA-256 ของไฟล์ที่ดาวน์โหลดไม่ตรงกัน", runtimeMissing: "ไม่พบไฟล์เรียกใช้ AI ภายในเครื่อง", complete: "ติดตั้ง AI ภายในเครื่องแล้ว", completeDetail: "เลือก Local AI สำหรับการแปลหรือรู้จำเสียงได้ในหน้าผู้ดูแล", ok: "ตกลง", menuSetup: "ติดตั้ง AI ภายในเครื่องและเปลี่ยนโมเดล", caDownload: "ดาวน์โหลดใบรับรอง HTTPS สำหรับโทรศัพท์", running: "เปลี่ยนโมเดลไม่ได้ขณะมีเซสชันทำงาน", runningDetail: "โปรดจบเซสชันแล้วลองอีกครั้ง", failed: "ติดตั้ง AI ภายในเครื่องไม่สำเร็จ", promptTitle: "AI ภายในเครื่อง", promptMessage: "ติดตั้งโมเดลสำหรับแปลและรู้จำเสียงโดยไม่ใช้อินเทอร์เน็ตหรือไม่", promptDetail: "ข้ามตอนนี้และติดตั้งภายหลังจากเมนูการตั้งค่าได้", install: "ติดตั้ง", later: "ภายหลัง", desktopPrompt: "สร้างทางลัดบนเดสก์ท็อปหรือไม่", createShortcut: "สร้าง", noShortcut: "ไม่สร้าง",
  },
  si: {
    installedOnly: "දේශීය AI Windows ස්ථාපිත අනුවාදයේ පමණක් සහාය දක්වයි.", translationTitle: "දේශීය පරිවර්තන ආකෘතිය", transcriptionTitle: "දේශීය හඬ හඳුනාගැනීමේ ආකෘතිය",
    recommended: "නිර්දේශිත", modelNote: "විශාල ආකෘති වඩා හොඳ ගුණාත්මක බවක් ලබා දෙන නමුත් වැඩි මතකයක් සහ ආරම්භක කාලයක් අවශ්‍ය වේ.", cancel: "අවලංගු කරන්න",
    termsTitle: "ආකෘති භාවිත නියම", termsMessage: "TranslateGemma සහ Whisper බාගත කරනු ඇත.", termsDetail: "ස්ථාපනයේදී අන්තර්ජාලය අවශ්‍ය වේ. TranslateGemma, Gemma නියමවලට යටත් වේ. කියවා එකඟ වූ පසු පමණක් ඉදිරියට යන්න.", openTerms: "නියම විවෘත කරන්න", agree: "එකඟ වී ඉදිරියට",
    modelFolder: "ආකෘති ගබඩා ෆෝල්ඩරය", tempFolder: "තාවකාලික බාගැනීම් ෆෝල්ඩරය", noSpace: "ෆෝල්ඩරයේ ප්‍රමාණවත් ඉඩක් නැත.", need: "අවශ්‍ය", downloadFailed: "බාගැනීම අසාර්ථකයි", checksumMismatch: "බාගත් ගොනුවේ SHA-256 අගය නොගැළපේ", runtimeMissing: "දේශීය AI ක්‍රියාත්මක ගොනුව හමු නොවීය", complete: "දේශීය AI ස්ථාපනය සම්පූර්ණයි.", completeDetail: "පරිපාලක පිටුවේ පරිවර්තනය හෝ හඬ හඳුනාගැනීම සඳහා Local AI තෝරාගත හැක.", ok: "හරි", menuSetup: "දේශීය AI ස්ථාපනය සහ ආකෘති වෙනස් කිරීම", caDownload: "දුරකථනය සඳහා දේශීය HTTPS සහතිකය බාගන්න", running: "සක්‍රීය සැසි ඇති විට ආකෘති වෙනස් කළ නොහැක.", runningDetail: "සැසි අවසන් කර නැවත උත්සාහ කරන්න.", failed: "දේශීය AI ස්ථාපනය අසාර්ථකයි", promptTitle: "දේශීය AI", promptMessage: "අන්තර්ජාලය නොමැතිව පරිවර්තනය සහ හඬ හඳුනාගැනීම සඳහා ආකෘති ස්ථාපනය කරන්නද?", promptDetail: "දැන් මඟහැර පසුව සැකසුම් මෙනුවෙන් ස්ථාපනය කළ හැක.", install: "ස්ථාපනය", later: "පසුව", desktopPrompt: "ඩෙස්ක්ටොප් කෙටිමඟක් සාදන්නද?", createShortcut: "සාදන්න", noShortcut: "සාදන්න එපා",
  },
};

function stringsFor(app) {
  const locale = app.getLocale().toLowerCase();
  return UI[locale.startsWith("vi") ? "vi" : locale.startsWith("th") ? "th" : locale.startsWith("si") ? "si" : "ko"];
}

function isPortable() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

function applyLocalAiEnvironment(settings) {
  if (settings?.localHttps) {
    process.env.LOCAL_HTTPS_PFX_PATH = settings.localHttps.pfx;
    process.env.LOCAL_HTTPS_PFX_PASSWORD = settings.localHttps.password;
    process.env.LOCAL_HTTPS_CA_PATH = settings.localHttps.ca;
    process.env.LOCAL_HTTPS_PORT = "3443";
  }
  const local = settings?.localAi;
  if (!local?.enabled) return;
  process.env.LOCAL_LLAMA_SERVER_PATH = local.llamaServer;
  process.env.LOCAL_TRANSLATION_MODEL_PATH = local.translationModelPath;
  process.env.LOCAL_TRANSLATION_MODEL_ID = `translategemma-${local.translationModel}`;
  process.env.LOCAL_WHISPER_SERVER_PATH = local.whisperServer;
  process.env.LOCAL_TRANSCRIPTION_MODEL_PATH = local.transcriptionModelPath;
  process.env.LOCAL_AI_USE_GPU = local.useGpu ? "1" : "0";
}

function ps(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function ensureLocalCertificate({ app, settings, save, addresses }) {
  if (process.platform !== "win32" || isPortable()) return false;
  if (settings.localHttps?.pfx && existsSync(settings.localHttps.pfx) && existsSync(settings.localHttps.ca)) {
    applyLocalAiEnvironment(settings);
    return true;
  }
  const directory = path.join(app.getPath("userData"), "tls");
  mkdirSync(directory, { recursive: true });
  const pfx = path.join(directory, "server.pfx");
  const ca = path.join(directory, "local-ca.cer");
  const password = randomBytes(24).toString("base64url");
  const sans = ["DNS=localhost", ...addresses.map((address) => `IPAddress=${address}`)].join("&");
  const command = [
    "$ErrorActionPreference='Stop'",
    "$caCert=New-SelfSignedCertificate -Type Custom -Subject 'CN=Live Conference Translation Local CA' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyUsage CertSign,CRLSign,DigitalSignature -KeyExportPolicy Exportable -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(10) -TextExtension @('2.5.29.19={critical}{text}ca=true')",
    `$leaf=New-SelfSignedCertificate -Type Custom -Subject 'CN=Live Conference Translation' -Signer $caCert -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage DigitalSignature,KeyEncipherment -KeyExportPolicy Exportable -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(3) -TextExtension @(${ps(`2.5.29.17={text}${sans}`)})`,
    `$secure=ConvertTo-SecureString ${ps(password)} -AsPlainText -Force`,
    `Export-PfxCertificate -Cert $leaf -FilePath ${ps(pfx)} -Password $secure | Out-Null`,
    `Export-Certificate -Cert $caCert -FilePath ${ps(ca)} | Out-Null`,
    `Import-Certificate -FilePath ${ps(ca)} -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null`,
  ].join(";");
  await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
  settings.localHttps = { pfx, ca, password };
  save();
  applyLocalAiEnvironment(settings);
  return true;
}

function recommendedModels(totalMemory = os.totalmem()) {
  const gib = totalMemory / 1024 ** 3;
  return {
    translation: gib >= 40 ? "27b" : gib >= 20 ? "12b" : "4b",
    transcription: gib >= 16 ? "medium" : "small",
  };
}

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const follow = (value, redirects) => {
      const req = get(value, { headers }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 8) {
          response.resume();
          follow(new URL(response.headers.location, value).href, redirects + 1);
          return;
        }
        resolve(response);
      });
      req.on("error", reject);
    };
    follow(url, 0);
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(require("node:fs").createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(asset, destination, onProgress, text) {
  if (existsSync(destination) && await sha256(destination) === asset.sha256) return;
  const partial = `${destination}.part`;
  const offset = existsSync(partial) ? statSync(partial).size : 0;
  let response = await request(asset.url, offset ? { Range: `bytes=${offset}-` } : {});
  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.resume();
    throw new Error(`${text.downloadFailed}: HTTP ${response.statusCode}`);
  }
  const resumed = response.statusCode === 206 ? offset : 0;
  if (!resumed && offset) rmSync(partial, { force: true });
  const total = resumed + Number(response.headers["content-length"] ?? 0);
  let received = resumed;
  response.on("data", (chunk) => {
    received += chunk.length;
    if (total) onProgress(received / total);
  });
  await pipeline(response, createWriteStream(partial, { flags: resumed ? "a" : "w" }));
  if (await sha256(partial) !== asset.sha256) {
    rmSync(partial, { force: true });
    throw new Error(text.checksumMismatch);
  }
  rmSync(destination, { force: true });
  renameSync(partial, destination);
}

function exec(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => error ? reject(error) : resolve());
  });
}

function execText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
  });
}

async function gpuInfo() {
  const text = await execText("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
  ]);
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const devices = rows.filter((row) => row?.Name && !/Microsoft Basic|Remote Display/i.test(row.Name));
    return {
      available: devices.length > 0,
      vram: Math.max(0, ...devices.map((row) => Number(row.AdapterRAM) || 0)),
    };
  } catch {
    return { available: false, vram: 0 };
  }
}

async function extract(zip, directory) {
  mkdirSync(directory, { recursive: true });
  await exec("tar.exe", ["-xf", zip, "-C", directory]);
}

function findFile(directory, name) {
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of require("node:fs").readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

async function chooseModel(dialog, window, title, models, recommended, text) {
  const keys = Object.keys(models);
  const result = await dialog.showMessageBox(window, {
    type: "question",
    title,
    message: `${title}\n${text.recommended}: ${models[recommended].label}`,
    detail: text.modelNote,
    buttons: [...keys.map((key) => models[key].label), text.cancel],
    defaultId: keys.indexOf(recommended),
    cancelId: keys.length,
    noLink: true,
  });
  return keys[result.response] ?? null;
}

async function setupLocalAi({ app, dialog, shell, window, settings, save }) {
  const text = stringsFor(app);
  if (process.platform !== "win32" || isPortable()) {
    await dialog.showMessageBox(window, { type: "info", message: text.installedOnly, buttons: [text.ok] });
    return false;
  }
  const gpu = await gpuInfo();
  const health = recommendedModels();
  if (gpu.vram >= 20 * 1024 ** 3 && os.totalmem() >= 32 * 1024 ** 3) health.translation = "27b";
  else if (gpu.vram >= 10 * 1024 ** 3 && os.totalmem() >= 16 * 1024 ** 3) health.translation = "12b";
  const translation = await chooseModel(dialog, window, text.translationTitle, TRANSLATION_MODELS, health.translation, text);
  if (!translation) return false;
  const transcription = await chooseModel(dialog, window, text.transcriptionTitle, TRANSCRIPTION_MODELS, health.transcription, text);
  if (!transcription) return false;

  const license = await dialog.showMessageBox(window, {
    type: "warning",
    title: text.termsTitle,
    message: text.termsMessage,
    detail: text.termsDetail,
    buttons: [text.openTerms, text.agree, text.cancel],
    defaultId: 2,
    cancelId: 2,
  });
  if (license.response === 0) {
    await shell.openExternal("https://ai.google.dev/gemma/terms");
    return false;
  }
  if (license.response !== 1) return false;

  const selected = await dialog.showOpenDialog(window, {
    title: text.modelFolder,
    defaultPath: settings.localAi?.modelDir ?? path.join(app.getPath("userData"), "local-ai"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return false;
  const modelDir = selected.filePaths[0];
  const tempSelected = await dialog.showOpenDialog(window, {
    title: text.tempFolder,
    defaultPath: settings.localAi?.tempDir ?? path.join(app.getPath("temp"), "LiveConfTranslation"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (tempSelected.canceled || !tempSelected.filePaths[0]) return false;
  const tempDir = tempSelected.filePaths[0];
  const runtimeDir = path.join(modelDir, "runtime");
  const modelsDir = path.join(modelDir, "models");
  const downloadDir = path.join(tempDir, "downloads");
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });
  mkdirSync(downloadDir, { recursive: true });
  const modelFs = statfsSync(modelsDir);
  const freeBytes = modelFs.bavail * modelFs.bsize;
  const requiredBytes = translation === "27b" ? 21e9 : translation === "12b" ? 11e9 : 5e9;
  if (freeBytes < requiredBytes) throw new Error(`${text.noSpace} ${text.need}: ${Math.ceil(requiredBytes / 1e9)} GB`);
  const assets = [
    { asset: RUNTIMES.llama, destination: path.join(downloadDir, RUNTIMES.llama.file) },
    { asset: RUNTIMES.whisper, destination: path.join(downloadDir, RUNTIMES.whisper.file) },
    { asset: TRANSLATION_MODELS[translation], destination: path.join(modelsDir, TRANSLATION_MODELS[translation].file) },
    { asset: TRANSCRIPTION_MODELS[transcription], destination: path.join(modelsDir, TRANSCRIPTION_MODELS[transcription].file) },
  ];
  window.setProgressBar(0);
  try {
    for (let index = 0; index < assets.length; index += 1) {
      const { asset, destination } = assets[index];
      await download(asset, destination, (fraction) => window.setProgressBar((index + fraction) / assets.length), text);
    }
    await extract(path.join(downloadDir, RUNTIMES.llama.file), path.join(runtimeDir, "llama"));
    await extract(path.join(downloadDir, RUNTIMES.whisper.file), path.join(runtimeDir, "whisper"));
    const localAi = {
      enabled: true,
      modelDir,
      tempDir,
      translationModel: translation,
      transcriptionModel: transcription,
      translationModelPath: path.join(modelsDir, TRANSLATION_MODELS[translation].file),
      transcriptionModelPath: path.join(modelsDir, TRANSCRIPTION_MODELS[transcription].file),
      llamaServer: findFile(path.join(runtimeDir, "llama"), RUNTIMES.llama.binary),
      whisperServer: findFile(path.join(runtimeDir, "whisper"), RUNTIMES.whisper.binary),
      useGpu: gpu.available,
    };
    if (!localAi.llamaServer || !localAi.whisperServer) throw new Error(text.runtimeMissing);
    settings.localAi = localAi;
    save();
    applyLocalAiEnvironment(settings);
    await dialog.showMessageBox(window, { type: "info", message: text.complete, detail: text.completeDetail, buttons: [text.ok] });
    return true;
  } finally {
    window.setProgressBar(-1);
  }
}

module.exports = { applyLocalAiEnvironment, ensureLocalCertificate, isPortable, recommendedModels, setupLocalAi, stringsFor };
