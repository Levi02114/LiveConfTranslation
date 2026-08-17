function isPrivate(address) {
  if (address.startsWith("10.") || address.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(address);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isVirtualInterface(name) {
  return /virtual|virtualbox|vbox|vmware|hyper-v|vethernet|wsl|docker|podman|tailscale|zerotier|local area connection\*|^(br-|veth|virbr|zt|tun\d|tap\d|wg\d)/i.test(
    name,
  );
}

function listLanAddresses(interfaces) {
  const seen = new Set();
  return Object.entries(interfaces).flatMap(([name, items]) =>
    (items ?? [])
      .filter(
        (item) =>
          item &&
          (item.family === "IPv4" || item.family === 4) &&
          !item.internal &&
          !item.address.startsWith("169.254.") &&
          !seen.has(item.address),
      )
      .map((item) => {
        seen.add(item.address);
        return { name, address: item.address, virtual: isVirtualInterface(name) };
      }),
  );
}

function pickLanAddress(interfaces) {
  const addresses = listLanAddresses(interfaces);

  return (
    addresses.find((item) => !item.virtual && isPrivate(item.address))?.address ??
    addresses.find((item) => !item.virtual)?.address ??
    addresses.find((item) => isPrivate(item.address))?.address ??
    addresses[0]?.address ??
    "127.0.0.1"
  );
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

module.exports = { extractQuickTunnelUrl, listLanAddresses, parseHealth, pickLanAddress };
