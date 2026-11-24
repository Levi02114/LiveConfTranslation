import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// electron-builder 의 macOS zip 은 Linux 에서 만들면 프레임워크 심볼릭 링크를 실제 파일로 풀어 넣는다.
// 그러면 번들 구조가 깨져 Mac 에서 codesign 이 실패하므로, `dir` 결과를 심볼릭 링크째(-y) 직접 압축한다.
const release = path.resolve("release");
const app = "Live Conference Translation.app";

for (const [directory, arch] of [["mac-arm64", "arm64"], ["mac", "x64"]]) {
  const bundle = path.join(release, directory, app);
  if (!existsSync(bundle)) continue;
  const plist = readFileSync(path.join(bundle, "Contents", "Info.plist"), "utf8");
  const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
  if (!version) throw new Error(`${bundle} 에서 버전을 읽지 못했습니다.`);
  const output = path.join(release, `LiveConfTranslation-${version}-mac-${arch}.zip`);
  rmSync(output, { force: true });
  await promisify(execFile)("zip", ["-qry", "-9", output, app], { cwd: path.dirname(bundle) });
  console.log(output);
}
