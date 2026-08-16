function isPrivate(address) {
  if (address.startsWith("10.") || address.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(address);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function pickLanAddress(interfaces) {
  const addresses = Object.values(interfaces)
    .flat()
    .filter((item) => item && (item.family === "IPv4" || item.family === 4) && !item.internal)
    .map((item) => item.address);

  return addresses.find(isPrivate) ?? addresses[0] ?? "127.0.0.1";
}

function extractQuickTunnelUrl(text) {
  return text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com\b/i)?.[0] ?? null;
}

function parseHealth(text) {
  try {
    const health = JSON.parse(text);
    if (health.service !== "live-conf-translation") return null;
    return {
      openMeetings:
        Number.isInteger(health.openMeetings) && health.openMeetings >= 0 ? health.openMeetings : 0,
    };
  } catch {
    return null;
  }
}

module.exports = { extractQuickTunnelUrl, parseHealth, pickLanAddress };
