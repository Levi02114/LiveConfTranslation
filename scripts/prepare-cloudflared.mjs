import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const version = "2026.8.2";
const expectedSha256 = "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5";
const outputDir = path.resolve(".tmp");
const binaryPath = path.join(outputDir, "cloudflared-windows-amd64.exe");
const licensePath = path.join(outputDir, "cloudflared-LICENSE");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 다운로드 실패: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(outputDir, { recursive: true });

let binary = await readFile(binaryPath).catch(() => null);
if (!binary || sha256(binary) !== expectedSha256) {
  binary = await download(
    `https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-windows-amd64.exe`,
  );
  if (sha256(binary) !== expectedSha256) throw new Error("cloudflared SHA-256 검증에 실패했습니다.");
  const temporaryPath = `${binaryPath}.download`;
  await writeFile(temporaryPath, binary);
  await rename(temporaryPath, binaryPath);
}

const license = await download(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`);
await writeFile(licensePath, license);
console.log(`cloudflared ${version} 준비 완료 (${expectedSha256})`);
