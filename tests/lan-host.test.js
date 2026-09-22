import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanIpv4Addresses, primaryLanIpv4 } from '../lib/lan-host.js';

test('primaryLanIpv4 returns string or null', () => {
  const primary = primaryLanIpv4();
  assert.ok(primary === null || /^\d+\.\d+\.\d+\.\d+$/.test(primary));
  const all = getLanIpv4Addresses();
  assert.ok(Array.isArray(all));
  if (primary) assert.ok(all.includes(primary));
});
