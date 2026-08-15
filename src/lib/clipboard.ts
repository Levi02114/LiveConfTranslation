/**
 * 클립보드 복사.
 *
 * `navigator.clipboard` 는 **보안 컨텍스트(HTTPS 또는 localhost)에서만** 존재한다.
 * 이 서비스는 TLS 없이 로컬 네트워크로 쓰는 게 전제라, 참석자·운영자가
 * `http://192.168.x.x:3000` 으로 들어오면 그 API 자체가 없다. 그래서 구식
 * `execCommand('copy')` 폴백이 **예외 경로가 아니라 기본 경로**다.
 *
 * 반환값으로 성공 여부를 알린다. 조용히 실패하면 사용자는 눌렀는지조차 알 수 없다.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한 거부 등. 아래 폴백으로 내려간다.
    }
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // 화면 밖으로 밀면 iOS 가 선택을 무시한다. 보이지 않게만 둔다.
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";

    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);

    // 폐기 예정 API 지만, 비보안 컨텍스트에서 동작하는 유일한 수단이다.
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
