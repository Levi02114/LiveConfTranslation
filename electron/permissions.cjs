function microphoneAllowed(requestingUrl, mediaTypes, topLevelUrl, origin) {
  try {
    const request = new URL(requestingUrl);
    const topLevel = new URL(topLevelUrl);
    const inputPath = /^\/(?:(in|capture)\/|admin(?:\/meetings\/[^/]+)?\/?$)/;
    return request.origin === origin && topLevel.origin === origin &&
      inputPath.test(request.pathname) && inputPath.test(topLevel.pathname) &&
      mediaTypes?.length === 1 && mediaTypes[0] === "audio";
  } catch { return false; }
}

/**
 * 마이크 목록의 "컴퓨터 소리"(화면 공유 API로 받는 시스템 소리). 마이크와 같은 내부 입력 화면에서만,
 * 시스템 소리(loopback)를 줄 수 있는 Windows와 macOS(14.2 이상, CoreAudio Tap)에서만 허용한다.
 * 영상은 페이지가 받자마자 멈춘다.
 */
function systemAudioAllowed(requestingUrl, topLevelUrl, origin, platform = process.platform) {
  return (platform === "win32" || platform === "darwin") && microphoneAllowed(requestingUrl, ["audio"], topLevelUrl, origin);
}

/**
 * getDisplayMedia 권한 요청인지. Electron 43은 이를 "display-capture"가 아니라 장치 목록이 빈 "media"로
 * 보낸다(마이크 요청은 ["audio"]). 둘 다 받아야 컴퓨터 소리가 막히지 않는다.
 */
function displayCaptureRequested(permission, mediaTypes) {
  return permission === "display-capture" || (permission === "media" && !mediaTypes?.length);
}

module.exports = { displayCaptureRequested, microphoneAllowed, systemAudioAllowed };
