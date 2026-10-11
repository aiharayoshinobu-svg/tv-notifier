import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import webPush from 'web-push';

const path = 'keys.local.json';
if (existsSync(path)) { console.error('keys.local.jsonは既に存在します。既存の鍵を上書きしません。'); process.exit(1); }
const vapid = webPush.generateVAPIDKeys();
writeFileSync(path, JSON.stringify({ ADMIN_TOKEN: randomBytes(32).toString('base64url'), JOB_TOKEN: randomBytes(32).toString('base64url'), VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }, null, 2), { mode: 0o600 });
console.log('keys.local.jsonを作成しました。このファイルは公開・アップロードしないでください。');
