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

module.exports = { microphoneAllowed };
