import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const version = "2026.8.2";
const outputDir = path.resolve(".tmp");
const licensePath = path.join(outputDir, "cloudflared-LICENSE");

// `--mac` 이면 macOS(arm64·x64)용도 준비한다. 파일 이름의 arch 는 electron-builder 의 ${arch} 와 같다.
const targets = [
  { asset: "cloudflared-windows-amd64.exe", output: "cloudflared-windows-amd64.exe", sha256: "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5" },
  ...(process.argv.includes("--mac") ? [
    { asset: "cloudflared-darwin-arm64.tgz", output: "cloudflared-darwin-arm64", sha256: "9042c2c5d8b2de78e60f313d5fb31b6c5c1cebde787a3caf1f2c9588084ac442" },
    { asset: "cloudflared-darwin-amd64.tgz", output: "cloudflared-darwin-x64", sha256: "f1727723c586500e2092368ae21871b3df7ddfd2cb097f22d81bee4a9c458bb4" },
  ] : []),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 다운로드 실패: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(outputDir, { recursive: true });

for (const target of targets) {
  const binaryPath = path.join(outputDir, target.output);
  const archivePath = path.join(outputDir, target.asset);
  const packed = target.asset.endsWith(".tgz");
  // 검증 대상은 릴리스 자산 자체다. tgz 는 받은 압축 파일을 남겨 두고 다시 검사한다.
  let asset = await readFile(packed ? archivePath : binaryPath).catch(() => null);
  if (!asset || sha256(asset) !== target.sha256) {
    asset = await download(`https://github.com/cloudflare/cloudflared/releases/download/${version}/${target.asset}`);
    if (sha256(asset) !== target.sha256) throw new Error(`${target.asset} SHA-256 검증에 실패했습니다.`);
    const temporaryPath = `${packed ? archivePath : binaryPath}.download`;
    await writeFile(temporaryPath, asset);
    await rename(temporaryPath, packed ? archivePath : binaryPath);
  }
  if (packed) {
    const directory = await mkdtemp(path.join(outputDir, "cloudflared-"));
    try {
      await promisify(execFile)("tar", ["-xzf", archivePath, "-C", directory, "cloudflared"]);
      await rename(path.join(directory, "cloudflared"), binaryPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await chmod(binaryPath, 0o755);
  }
}

const license = await download(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`);
await writeFile(licensePath, license);
console.log(`cloudflared ${version} 준비 완료 (${targets.map((target) => target.output).join(", ")})`);
