import { type Env, type Episode, type Show, type Source, PRESETS, hash, isUpcoming, record, revision, text, validateShows } from './model';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function settings(env: Env): Promise<Show[]> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE id = 1').first<{ value: string }>();
  return row ? JSON.parse(row.value) : structuredClone(PRESETS);
}
async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') || 0) > 250_000) throw new HttpError(413, 'リクエストが大きすぎます');
  const raw = await request.text();
  if (raw.length > 250_000) throw new HttpError(413, 'リクエストが大きすぎます');
  try { return record(JSON.parse(raw)); } catch { throw new HttpError(400, 'JSON形式が不正です'); }
}
async function authorize(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) throw new HttpError(503, '認証用Secretが未設定です');
  const input = request.headers.get('Authorization') || '';
  if (!input.startsWith('Bearer ') || await hash(input.slice(7)) !== await hash(secret)) throw new HttpError(401, '接続キーが違います');
}
async function state(env: Env, internal: boolean) {
  const now = new Date();
  const [shows, episodes, statuses, subscriptions] = await Promise.all([
    settings(env),
    env.DB.prepare('SELECT value, revision FROM episodes WHERE expires_at > ? ORDER BY expires_at LIMIT 1000').bind(now.toISOString()).all<{ value: string; revision: string }>(),
    env.DB.prepare('SELECT * FROM source_status').all(),
    env.DB.prepare(internal ? 'SELECT * FROM subscriptions' : 'SELECT id, created_at FROM subscriptions').all(),
  ]);
  const data = episodes.results.map(row => ({ ...JSON.parse(row.value) as Episode, revision: row.revision })).filter(e => isUpcoming(e, now));
  if (!internal) return { shows, episodes: data, statuses: statuses.results, subscriptions: subscriptions.results };
  const [deliveries, tests] = await Promise.all([
    env.DB.prepare('SELECT * FROM deliveries').all(),
    env.DB.prepare('SELECT * FROM test_requests').all(),
  ]);
  return { shows, episodes: data, statuses: statuses.results, subscriptions: subscriptions.results, deliveries: deliveries.results, tests: tests.results };
}
function source(value: unknown): Source {
  if (value !== 'nhk' && value !== 'tbs' && value !== 'ntv') throw new HttpError(400, '取得元が不正です');
  return value;
}
async function route(request: Request, env: Env): Promise<unknown> {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === '/api/config' && method === 'GET') return { publicKey: env.VAPID_PUBLIC_KEY, frontendUrl: env.FRONTEND_URL, presets: PRESETS };
  const internal = path.startsWith('/internal/');
  if (!internal && !path.startsWith('/api/')) throw new HttpError(404, '見つかりません');
  await authorize(request, internal ? env.JOB_TOKEN : env.ADMIN_TOKEN);
  if ((path === '/api/state' || path === '/internal/state') && method === 'GET') return state(env, internal);
  if (method !== 'POST') throw new HttpError(404, '見つかりません');
  const body = await jsonBody(request);
  if (path === '/api/settings') {
    let shows: Show[];
    try { shows = validateShows(body.shows); } catch (e) { throw new HttpError(400, (e as Error).message); }
    await env.DB.prepare('INSERT INTO settings(id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').bind(JSON.stringify(shows)).run();
    return { ok: true };
  }
  if (path === '/api/subscribe') {
    // Keep this endpoint free of Node crypto and push encryption.
    const s = record(body.subscription);
    const keys = record(s.keys);
    let url: URL;
    try { url = new URL(text(s.endpoint)); } catch { throw new HttpError(400, '通知先が不正です'); }
    const hosts = ['fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.href.length > 2048 || !hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw new HttpError(400, '通知先が不正です');
    for (const [name, length] of [['p256dh', 65], ['auth', 16]] as const) {
      const value = text(keys[name]);
      let valid = false;
      try { valid = /^[\w-]+={0,2}$/.test(value) && atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === length; } catch { /* invalid base64 */ }
      if (!valid) throw new HttpError(400, 'Push公開鍵が不正です');
    }
    const id = await hash(url.href);
    const exists = await env.DB.prepare('SELECT id FROM subscriptions WHERE id=?').bind(id).first();
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM subscriptions').first<{ count: number }>();
    if (!exists && (count?.count || 0) >= 5) throw new HttpError(409, '登録できる端末は最大5台です。不要な端末を削除してください');
    const value = JSON.stringify({ endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    await env.DB.prepare('INSERT INTO subscriptions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').bind(id, value, new Date().toISOString()).run();
    return { id };
  }
  if (path === '/api/unsubscribe' || path === '/internal/unsubscribe') {
    await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(text(body.id)).run();
    return { ok: true };
  }
  if (path === '/api/test') {
    const id = text(body.id);
    if (!await env.DB.prepare('SELECT id FROM subscriptions WHERE id=?').bind(id).first()) throw new HttpError(404, 'この端末は通知登録されていません');
    await env.DB.prepare('INSERT INTO test_requests VALUES (?, ?) ON CONFLICT(subscription_id) DO UPDATE SET created_at=excluded.created_at').bind(id, new Date().toISOString()).run();
    return { ok: true, message: '次回のGitHub Actions実行時にテスト通知を送ります' };
  }
  if (path === '/internal/begin') {
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM episodes WHERE expires_at <= ?').bind(now.toISOString()),
      env.DB.prepare('DELETE FROM checks WHERE started_at < ?').bind(new Date(now.getTime() - 2 * 86400_000).toISOString()),
      env.DB.prepare('DELETE FROM test_requests WHERE created_at < ?').bind(new Date(now.getTime() - 86400_000).toISOString()),
    ]);
    const result = await env.DB.prepare('INSERT OR IGNORE INTO checks VALUES (?, ?)').bind(hour, now.toISOString()).run();
    return { acquired: result.meta.changes === 1 };
  }
  if (path === '/internal/episodes') {
    if (!Array.isArray(body.episodes) || body.episodes.length > 20) throw new HttpError(400, '1回の登録は20件までです');
    const statements: D1PreparedStatement[] = [];
    for (const raw of body.episodes) {
      const e = record(raw) as unknown as Episode;
      source(e.source);
      if (!e.id || e.id.length > 500 || !e.title || e.title.length > 180 || !e.showId || !Number.isFinite(Date.parse(e.expiresAt)) || !Number.isFinite(Date.parse(e.start))) throw new HttpError(400, '放送データが不正です');
      statements.push(env.DB.prepare('INSERT INTO episodes VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, revision=excluded.revision, expires_at=excluded.expires_at').bind(e.id, e.source, JSON.stringify(e), await revision(e), e.expiresAt));
    }
    if (statements.length) await env.DB.batch(statements);
    return { ok: true };
  }
  if (path === '/internal/source') {
    const name = source(body.source);
    const now = new Date().toISOString();
    const error = typeof body.error === 'string' ? body.error.slice(0, 300) : null;
    if (!error) {
      if (!Array.isArray(body.ids) || body.ids.length > 1000 || body.ids.some(id => typeof id !== 'string')) throw new HttpError(400, '放送ID一覧が不正です');
      await env.DB.prepare('DELETE FROM episodes WHERE source=? AND id NOT IN (SELECT value FROM json_each(?))').bind(name, JSON.stringify(body.ids)).run();
    }
    await env.DB.prepare('INSERT INTO source_status VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET checked_at=excluded.checked_at, last_success=COALESCE(excluded.last_success, source_status.last_success), error=excluded.error').bind(name, now, error ? null : now, error).run();
    return { ok: true };
  }
  if (path === '/internal/delivered') {
    if (!Array.isArray(body.items) || body.items.length > 20) throw new HttpError(400, '通知記録は20件までです');
    const statements = body.items.map(item => {
      const d = record(item);
      return env.DB.prepare('INSERT INTO deliveries VALUES (?, ?, ?) ON CONFLICT(subscription_id, episode_id) DO UPDATE SET revision=excluded.revision').bind(text(d.subscriptionId), text(d.episodeId), text(d.revision));
    });
    if (statements.length) await env.DB.batch(statements);
    return { ok: true };
  }
  if (path === '/internal/test-done') {
    await env.DB.prepare('DELETE FROM test_requests WHERE subscription_id=?').bind(text(body.id)).run();
    return { ok: true };
  }
  throw new HttpError(404, '見つかりません');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let origin: string;
    try { origin = new URL(env.FRONTEND_URL).origin; } catch { return new Response('FRONTEND_URLが未設定です', { status: 503 }); }
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && requestOrigin !== origin) return new Response(JSON.stringify({ error: 'このサイトからは接続できません' }), { status: 403, headers });
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return new Response(null, { status: 204, headers });
    }
    try { return new Response(JSON.stringify(await route(request, env)), { headers }); }
    catch (e) {
      const error = e instanceof HttpError ? e : new HttpError(500, 'サーバー処理に失敗しました。D1の初期化と設定を確認してください');
      return new Response(JSON.stringify({ error: error.message }), { status: error.status, headers });
    }
  },
};
