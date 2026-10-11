import { collect } from '../worker/src/sources';
import { type Episode, type Show, type SourceEnv, isUpcoming, revision } from '../worker/src/model';
import { type Subscription, payload, sendPush, validateSubscription } from '../worker/src/push';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const server = process.env.WORKER_URL;
const token = process.env.JOB_TOKEN;
if (!server || !token) throw new Error('WORKER_URL と JOB_TOKEN を設定してください');
const workerUrl = new URL(server);
if (workerUrl.protocol !== 'https:' && workerUrl.hostname !== 'localhost' && workerUrl.hostname !== '127.0.0.1') throw new Error('WorkerにはHTTPSで接続してください');
async function api<T>(path: string, body?: object): Promise<T> {
  let response: Response;
  try { response = await fetch(new URL(path, workerUrl), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Workerに接続できません'); }
  if (!response.ok) throw new Error(`Worker APIエラー: ${response.status}`);
  return response.json() as Promise<T>;
}
interface Snapshot {
  shows: Show[];
  episodes: (Episode & { revision: string })[];
  subscriptions: { id: string; value: string }[];
  deliveries: { subscription_id: string; episode_id: string; revision: string }[];
  tests: { subscription_id: string }[];
}
export async function runPoll() {
  const config = await api<{ publicKey: string; frontendUrl: string }>('/api/config');
  const vapid = { subject: process.env.VAPID_SUBJECT || '', publicKey: process.env.VAPID_PUBLIC_KEY || '', privateKey: process.env.VAPID_PRIVATE_KEY || '' };
  if (!vapid.subject || !vapid.publicKey || !vapid.privateKey || vapid.publicKey !== config.publicKey) throw new Error('VAPID設定が不足または公開鍵が不一致です');
  const lock = await api<{ acquired: boolean }>('/internal/begin', {});
  if (!lock.acquired) { console.log('この時間帯はチェック済みです。NHK API上限を守るため取得を省略します。'); return { skipped: true, delivered: 0, sourceFailures: 0, pushFailures: 0 }; }
  let snapshot = await api<Snapshot>('/internal/state');
  const env: SourceEnv = { NHK_API_KEY: process.env.NHK_API_KEY, NHK_AREA: '140', ENABLE_TBS: process.env.ENABLE_TBS || 'false', ENABLE_NTV: process.env.ENABLE_NTV || 'false' };
  let sourceFailures = 0;
  for (const name of ['nhk', 'tbs', 'ntv'] as const) {
    try {
      const episodes = (await collect(name, env, snapshot.shows, new Date())).filter(e => isUpcoming(e, new Date()));
      if (episodes.length > 1000) throw new Error('個人利用の保存上限を超えています');
      for (let i = 0; i < episodes.length; i += 20) await api('/internal/episodes', { episodes: episodes.slice(i, i + 20) });
      await api('/internal/source', { source: name, ids: episodes.map(e => e.id) });
      console.log(`${name}: ${episodes.length}件を確認しました`);
    } catch (e) {
      const disabled = (name === 'tbs' && env.ENABLE_TBS !== 'true') || (name === 'ntv' && env.ENABLE_NTV !== 'true');
      // Do not publish upstream response bodies or request URLs containing the NHK key.
      const message = e instanceof Error && !/https?:|key=/.test(e.message) ? e.message : '情報取得に失敗しました';
      await api('/internal/source', { source: name, error: message });
      console.log(`${name}: ${message}`);
      if (!disabled) sourceFailures++;
    }
  }
  snapshot = await api<Snapshot>('/internal/state');
  const previous = new Map(snapshot.deliveries.map(d => [`${d.subscription_id}|${d.episode_id}`, d.revision]));
  let delivered = 0;
  let pushFailures = 0;
  for (const device of snapshot.subscriptions) {
    let subscription: Subscription;
    try { subscription = validateSubscription(JSON.parse(device.value)); } catch { pushFailures++; continue; }
    let expired = false;
    const send = async (data: object) => {
      try {
        const status = await sendPush(subscription, data, vapid);
        if (status === 404 || status === 410) {
          expired = true;
          await api('/internal/unsubscribe', { id: device.id });
        }
        if (status >= 200 && status < 300) return true;
        if (!expired) pushFailures++;
        return false;
      } catch { pushFailures++; return false; }
    };
    if (snapshot.tests.some(t => t.subscription_id === device.id)) {
      if (await send({ title: 'テレビのつづき', body: 'テスト通知です。番組の次回情報をこの端末へお届けします。', tag: 'test', url: config.frontendUrl })) {
        await api('/internal/test-done', { id: device.id });
      }
    }
    for (const episode of snapshot.episodes) {
      if (expired) break;
      const show = snapshot.shows.find(s => s.id === episode.showId);
      if (!show?.enabled || (episode.rerun && !show.includeReruns)) continue;
      const rev = await revision(episode);
      const before = previous.get(`${device.id}|${episode.id}`);
      if (before === rev) continue;
      if (await send(payload(episode, Boolean(before), config.frontendUrl))) {
        await api('/internal/delivered', { items: [{ subscriptionId: device.id, episodeId: episode.id, revision: rev }] });
        delivered++;
      }
    }
  }
  console.log(`Pushサービスが受理した通知: ${delivered}件、送信失敗: ${pushFailures}件、取得失敗: ${sourceFailures}件`);
  return { skipped: false, delivered, sourceFailures, pushFailures };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runPoll().then(result => { if (result.sourceFailures || result.pushFailures) process.exitCode = 1; }).catch(() => { console.error('チェックに失敗しました。Worker接続・認証・D1・VAPID設定を確認してください。'); process.exitCode = 1; });
}
