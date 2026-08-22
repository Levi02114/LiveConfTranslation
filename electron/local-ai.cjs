/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash, randomBytes } = require("node:crypto");
const { execFile } = require("node:child_process");
const { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } = require("node:fs");
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
  en: {
    caDownload: "Download the local HTTPS certificate for phones",
    httpsFailed: "Local HTTPS setup failed",
    httpsFailedDetail: "The app will continue over HTTP. Restart the app to retry certificate setup.",
  },
  ko: {
    caDownload: "휴대전화용 로컬 HTTPS 인증서 받기",
    httpsFailed: "로컬 HTTPS 설정 실패",
    httpsFailedDetail: "HTTP로 계속 실행합니다. 앱을 다시 시작하면 인증서 설정을 재시도합니다.",
  },
  vi: {
    caDownload: "Tải chứng chỉ HTTPS cục bộ cho điện thoại",
    httpsFailed: "Thiết lập HTTPS cục bộ thất bại",
    httpsFailedDetail: "Ứng dụng sẽ tiếp tục qua HTTP. Khởi động lại ứng dụng để thử lại thiết lập chứng chỉ.",
  },
  th: {
    caDownload: "ดาวน์โหลดใบรับรอง HTTPS สำหรับโทรศัพท์",
    httpsFailed: "ตั้งค่า HTTPS ภายในเครื่องไม่สำเร็จ",
    httpsFailedDetail: "แอปจะทำงานต่อผ่าน HTTP โปรดเริ่มแอปใหม่เพื่อลองตั้งค่าใบรับรองอีกครั้ง",
  },
  si: {
    caDownload: "දුරකථනය සඳහා දේශීය HTTPS සහතිකය බාගන්න",
    httpsFailed: "දේශීය HTTPS සැකසුම අසාර්ථකයි",
    httpsFailedDetail: "යෙදුම HTTP හරහා දිගටම ක්‍රියාත්මක වේ. සහතික සැකසුම නැවත උත්සාහ කිරීමට යෙදුම නැවත අරඹන්න.",
  },
};

function stringsFor(app) {
  const locale = app.getLocale().toLowerCase();
  return UI[locale.startsWith("ko") ? "ko" : locale.startsWith("vi") ? "vi" : locale.startsWith("th") ? "th" : locale.startsWith("si") ? "si" : "en"];
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
  } else {
    delete process.env.LOCAL_HTTPS_PFX_PATH;
    delete process.env.LOCAL_HTTPS_PFX_PASSWORD;
    delete process.env.LOCAL_HTTPS_CA_PATH;
    delete process.env.LOCAL_HTTPS_PORT;
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
  if (!settings) return false;
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
  delete settings.localHttps;
  save();
  applyLocalAiEnvironment(settings);
  rmSync(pfx, { force: true });
  rmSync(ca, { force: true });
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
    execFile(command, args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      reject(new Error(String(stderr).trim() || `${path.basename(command)} 종료 코드: ${error.code ?? "unknown"}`));
    });
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

function readConfig(file) {
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

function installedLocalAi(resourcesPath) {
  const file = path.join(resourcesPath, "local-ai-install.conf");
  if (!existsSync(file)) return null;
  const config = readConfig(file);
  const required = ["translationModelPath", "transcriptionModelPath", "llamaServer", "whisperServer"];
  if (!required.every((key) => config[key] && existsSync(config[key]))) return null;
  return {
    enabled: true,
    modelDir: config.modelDir,
    tempDir: config.tempDir,
    translationModel: config.translationModel,
    transcriptionModel: config.transcriptionModel,
    translationModelPath: config.translationModelPath,
    transcriptionModelPath: config.transcriptionModelPath,
    llamaServer: config.llamaServer,
    whisperServer: config.whisperServer,
    useGpu: config.useGpu === "1",
  };
}

async function installLocalAi(configFile) {
  const config = readConfig(configFile);
  const translation = config.translation;
  const transcription = config.transcription;
  if (!TRANSLATION_MODELS[translation] || !TRANSCRIPTION_MODELS[transcription]) {
    throw new Error("지원하지 않는 로컬 AI 모델입니다.");
  }
  const modelDir = config.modelDir;
  const tempDir = config.tempDir;
  if (!modelDir || !tempDir || !config.output) throw new Error("로컬 AI 설치 경로가 비어 있습니다.");
  const runtimeDir = path.join(modelDir, "runtime");
  const modelsDir = path.join(modelDir, "models");
  const downloadDir = path.join(tempDir, "downloads");
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });
  mkdirSync(downloadDir, { recursive: true });
  const modelFs = statfsSync(modelsDir);
  const freeBytes = modelFs.bavail * modelFs.bsize;
  const requiredBytes = translation === "27b" ? 21e9 : translation === "12b" ? 11e9 : 5e9;
  if (freeBytes < requiredBytes) throw new Error(`모델 폴더의 여유 공간이 부족합니다. 필요: ${Math.ceil(requiredBytes / 1e9)} GB`);
  const assets = [
    { asset: RUNTIMES.llama, destination: path.join(downloadDir, RUNTIMES.llama.file) },
    { asset: RUNTIMES.whisper, destination: path.join(downloadDir, RUNTIMES.whisper.file) },
    { asset: TRANSLATION_MODELS[translation], destination: path.join(modelsDir, TRANSLATION_MODELS[translation].file) },
    { asset: TRANSCRIPTION_MODELS[transcription], destination: path.join(modelsDir, TRANSCRIPTION_MODELS[transcription].file) },
  ];
  const text = { downloadFailed: "다운로드 실패", checksumMismatch: "다운로드 파일의 SHA-256이 일치하지 않습니다" };
  for (let index = 0; index < assets.length; index += 1) {
    const { asset, destination } = assets[index];
    console.log(`[${index + 1}/${assets.length}] ${asset.label ?? asset.file}`);
    await download(asset, destination, () => {}, text);
  }
  await extract(path.join(downloadDir, RUNTIMES.llama.file), path.join(runtimeDir, "llama"));
  await extract(path.join(downloadDir, RUNTIMES.whisper.file), path.join(runtimeDir, "whisper"));
  const gpu = await gpuInfo();
  const localAi = {
    enabled: "1",
    modelDir,
    tempDir,
    translationModel: translation,
    transcriptionModel: transcription,
    translationModelPath: path.join(modelsDir, TRANSLATION_MODELS[translation].file),
    transcriptionModelPath: path.join(modelsDir, TRANSCRIPTION_MODELS[transcription].file),
    llamaServer: findFile(path.join(runtimeDir, "llama"), RUNTIMES.llama.binary),
    whisperServer: findFile(path.join(runtimeDir, "whisper"), RUNTIMES.whisper.binary),
    useGpu: gpu.available ? "1" : "0",
  };
  if (!localAi.llamaServer || !localAi.whisperServer) throw new Error("로컬 AI 실행 파일을 찾지 못했습니다.");
  mkdirSync(path.dirname(config.output), { recursive: true });
  writeFileSync(config.output, `${Object.entries(localAi).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}

module.exports = { applyLocalAiEnvironment, ensureLocalCertificate, installLocalAi, installedLocalAi, isPortable, recommendedModels, stringsFor };
