import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webPush from 'web-push';
import { validateSubscription, payload, sendPush } from '../worker/src/push';
import { parseNtv } from '../worker/src/sources';

function device() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: Buffer.from(ecdh.getPublicKey()).toString('base64url'), auth: Buffer.from(randomBytes(16)).toString('base64url') } };
}
test('Apple/Google/Mozillaの通知先と正しい鍵を受け付ける', () => {
  const subscription = device();
  assert.deepEqual(validateSubscription(subscription), subscription);
  for (const endpoint of ['http://web.push.apple.com/a', 'https://push.apple.com.evil.example/a', 'https://127.0.0.1/a', 'https://user@web.push.apple.com/a', 'https://web.push.apple.com:8888/a']) assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  assert.throws(() => validateSubscription({ ...subscription, keys: { p256dh: 'bad', auth: 'bad' } }));
});
test('標準VAPID認証とaes128gcm暗号化を生成する', () => {
  const vapid = webPush.generateVAPIDKeys();
  const subscription = device();
  const plaintext = JSON.stringify({ title: '地球ドラマチック', body: '次回の放送' });
  const request = webPush.generateRequestDetails(subscription, plaintext, { vapidDetails: { subject: 'mailto:test@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
  assert.match(String(request.headers.Authorization), /^vapid t=/);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(request.body.length > Buffer.byteLength(plaintext));
  assert.equal(request.body.includes(Buffer.from(plaintext)), false);
});
test('通知に日付・チャンネルを含め、公式ページでなくPWAに戻る', () => {
  const [episode] = parseNtv([{ date: '2026.10.17', guest: 'ゲスト' }]);
  const notification = payload(episode, true, 'https://example.github.io/tv-next/');
  assert.equal(notification.title, '放送情報が更新されました');
  assert.match(notification.body, /2026-10-17.*時刻は公式サイト/);
  assert.match(notification.body, /日本テレビ/);
  assert.ok(notification.url.startsWith('https://example.github.io/tv-next/#episode='));
});
test('暗号化したPOSTをfetchで送信し、受理ステータスを返す', async () => {
  const original = globalThis.fetch;
  const vapid = webPush.generateVAPIDKeys();
  let called = false;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    called = true;
    assert.equal(init?.method, 'POST');
    assert.ok(init?.body instanceof ArrayBuffer);
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try { assert.equal(await sendPush(device(), { title: 'test' }, { subject: 'mailto:test@example.com', ...vapid }), 201); assert.equal(called, true); }
  finally { globalThis.fetch = original; }
});
