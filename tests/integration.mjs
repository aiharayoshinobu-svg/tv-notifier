import { spawn, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import webPush from 'web-push';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const config = 'tests/wrangler.toml';
const persist = `.wrangler/integration-${randomBytes(6).toString('hex')}`;
const vapid = webPush.generateVAPIDKeys();
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const schema = spawnSync(process.execPath, [cli, 'd1', 'execute', 'tv-next-test', '--local', '--config', config, '--persist-to', persist, '--file', 'worker/schema.sql'], { cwd: root, env, encoding: 'utf8' });
if (schema.status !== 0) throw new Error(schema.stderr || schema.stdout);
const server = spawn(process.execPath, [cli, 'dev', '--config', config, '--port', '8788', '--persist-to', persist, '--var', `VAPID_PUBLIC_KEY:${vapid.publicKey}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => { output += chunk.toString(); });
server.stderr.on('data', chunk => { output += chunk.toString(); });
const base = 'http://127.0.0.1:8788';
const admin = 'test-only-admin-token-not-for-production';
const job = 'test-only-job-token-not-for-production';
async function api(path, body, token = admin, origin = 'http://localhost:4173') {
  return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base + '/api/config')).ok) { ready = true; break; } } catch { /* Wait for the local workerd ready signal. */ }
    await setTimeout(500);
  }
  assert.ok(ready, output);
  const before = await (await api('/api/state')).json();
  assert.equal(before.shows.length, 6);
  assert.equal((await api('/api/state', undefined, 'wrong')).status, 401);
  assert.equal((await api('/internal/state')).status, 401);
  assert.equal((await api('/api/state', undefined, admin, 'https://evil.example')).status, 403);
  console.log('PASS: authentication, job/admin separation, CORS, initial settings');
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const subscription = { endpoint: 'https://web.push.apple.com/integration-fixture', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const registration = await api('/api/subscribe', { subscription });
  assert.equal(registration.status, 200);
  const { id } = await registration.json();
  const publicState = await (await api('/api/state')).json();
  assert.equal(publicState.subscriptions.length, 1);
  assert.equal(publicState.subscriptions[0].value, undefined);
  assert.equal((await api('/api/subscribe', { subscription: { ...subscription, endpoint: 'https://127.0.0.1/private' } })).status, 400);
  assert.equal((await api('/api/test', { id })).status, 200);
  assert.equal((await (await api('/internal/state', undefined, job)).json()).tests.length, 1);
  console.log('PASS: subscriptions, private endpoint protection, test queue');
  assert.equal((await api('/api/settings', { shows: before.shows.map(s => ({ ...s, includeReruns: true })) })).status, 200);
  assert.equal((await api('/api/settings', { shows: [...before.shows, before.shows[0]] })).status, 400);
  assert.equal((await (await api('/api/state')).json()).shows[0].includeReruns, true);
  const tomorrow = new Date(Date.now() + 86400_000);
  const episode = { id: 'nhk:test:event', showId: 'nhk-dramatic', source: 'nhk', title: '地球ドラマチック：テスト', start: tomorrow.toISOString(), dateOnly: false, channel: 'NHK Eテレ', rerun: false, url: null, expiresAt: new Date(Date.now() + 2 * 86400_000).toISOString() };
  assert.equal((await api('/internal/episodes', { episodes: [episode] }, job)).status, 200);
  let snapshot = await (await api('/internal/state', undefined, job)).json();
  assert.equal(snapshot.episodes.length, 1);
  const revision = snapshot.episodes[0].revision;
  assert.equal((await api('/internal/delivered', { items: [{ subscriptionId: id, episodeId: episode.id, revision }] }, job)).status, 200);
  assert.equal((await api('/internal/episodes', { episodes: [{ ...episode, title: '地球ドラマチック：変更' }] }, job)).status, 200);
  snapshot = await (await api('/internal/state', undefined, job)).json();
  assert.notEqual(snapshot.episodes[0].revision, snapshot.deliveries[0].revision);
  assert.equal((await api('/internal/source', { source: 'nhk', ids: [] }, job)).status, 200);
  snapshot = await (await api('/internal/state', undefined, job)).json();
  assert.equal(snapshot.episodes.length, 0);
  assert.equal(snapshot.deliveries.length, 0);
  console.log('PASS: preferences, episode revisions, delivery records, removed broadcast cleanup');
  process.env.WORKER_URL = base;
  process.env.JOB_TOKEN = job;
  process.env.NHK_API_KEY = 'test-only-api-key';
  process.env.ENABLE_TBS = 'true'; process.env.ENABLE_NTV = 'true';
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === 'program-api.nhk.jp') {
      const day = target.searchParams.get('date');
      return Response.json({ e1: { publication: [{ identifier: `test-${day}`, name: '地球ドラマチック：テスト', startDate: `${day}T23:59:00+09:00` }] } });
    }
    const day = tomorrow.toISOString().slice(0, 10);
    if (target.hostname === 'www.tbs.co.jp') return new Response(`<p id="next-date">${day.replace(/-/g, (m, index) => index === 4 ? '年' : '月')}日放送</p><h2 id="next-epname">世界遺産：テスト</h2>`);
    if (target.hostname === 'www.ntv.co.jp') return Response.json([{ date: day, guest: 'ゲスト' }]);
    if (target.hostname === 'web.push.apple.com') { sends++; assert.equal(init.method, 'POST'); assert.ok(init.body instanceof ArrayBuffer); return new Response(null, { status: 201 }); }
    return originalFetch(url, init);
  };
  try {
    const { runPoll } = await import('../scripts/poll.ts');
    const result = await runPoll();
    assert.equal(result.sourceFailures, 0);
    assert.equal(result.pushFailures, 0);
    assert.ok(result.delivered >= 9);
    assert.ok(sends > result.delivered, 'Includes one queued test notification');
    snapshot = await (await api('/internal/state', undefined, job)).json();
    assert.equal(snapshot.tests.length, 0);
    assert.equal(snapshot.deliveries.length, result.delivered);
    const previousSends = sends;
    const skipped = await runPoll();
    assert.equal(skipped.skipped, true);
    assert.equal(sends, previousSends);
    console.log('PASS: full Actions polling pipeline, encrypted Push POSTs (mocked service), delivery persistence, hourly quota lock');
  } finally { globalThis.fetch = originalFetch; }
  assert.equal((await api('/api/unsubscribe', { id })).status, 200);
  snapshot = await (await api('/internal/state', undefined, job)).json();
  assert.equal(snapshot.subscriptions.length, 0);
  assert.equal(snapshot.tests.length, 0);
  console.log('PASS: unsubscribe and cascaded private-data deletion');
} finally {
  server.kill('SIGTERM');
  await setTimeout(500);
  rmSync(resolve(root, persist), { recursive: true, force: true });
}
