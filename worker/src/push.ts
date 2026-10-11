import webPush from 'web-push';
import { record, text, type Episode } from './model';

export interface Subscription { endpoint: string; keys: { p256dh: string; auth: string } }
export function validateSubscription(input: unknown): Subscription {
  const s = record(input);
  const keys = record(s.keys);
  const endpoint = text(s.endpoint);
  const url = new URL(endpoint);
  const allowed = ['fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || endpoint.length > 2048 || !allowed.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('許可されていないPush通知先です');
  const validKey = (value: unknown, length: number) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+={0,2}$/.test(value)) return false;
    try { return atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === length; } catch { return false; }
  };
  if (!validKey(keys.p256dh, 65) || !validKey(keys.auth, 16)) throw new Error('Push公開鍵が不正です');
  return { endpoint, keys: { p256dh: text(keys.p256dh), auth: text(keys.auth) } };
}
export function payload(episode: Episode, changed: boolean, frontendUrl: string) {
  const date = episode.dateOnly ? `${episode.start}（時刻は公式サイトで確認）` : new Date(episode.start).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const appUrl = new URL(frontendUrl);
  appUrl.hash = `episode=${encodeURIComponent(episode.id)}`;
  return {
    title: changed ? '放送情報が更新されました' : '次回の放送が見つかりました',
    body: `${episode.title}\n${date} / ${episode.channel}${episode.source === 'nhk' ? '\n情報提供:ＮＨＫ' : ''}`,
    tag: episode.id, url: appUrl.href,
  };
}
export async function sendPush(subscription: Subscription, data: object, vapid: { subject: string; publicKey: string; privateKey: string }, ttl = 86400): Promise<number> {
  const request = webPush.generateRequestDetails(subscription, JSON.stringify(data), { vapidDetails: vapid, TTL: ttl, urgency: 'normal' });
  const response = await fetch(request.endpoint, { method: request.method, headers: request.headers, body: new Uint8Array(request.body).buffer, redirect: 'error', signal: AbortSignal.timeout(12000) });
  await response.body?.cancel();
  return response.status;
}
