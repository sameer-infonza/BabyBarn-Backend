import os from 'os';

/** Private RFC1918 / link-local IPv4 (for same-WiFi dev). */
function isPrivateIpv4(ip) {
  if (!ip || ip.includes(':')) return false;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const second = Number(m[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

export function getLanIpv4Addresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      if (!isPrivateIpv4(net.address)) continue;
      out.push(net.address);
    }
  }
  return [...new Set(out)];
}

export function primaryLanIpv4() {
  const all = getLanIpv4Addresses();
  return all.find((ip) => ip.startsWith('192.168.')) || all[0] || null;
}
