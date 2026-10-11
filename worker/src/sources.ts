import { load } from 'cheerio';
import { type Episode, type SourceEnv, type Show, type Source, dates, expiry, jstDay, normalize, officialUrl, parseDate, record, text } from './model';

export const CHANNELS: Record<string, string> = {
  g1: 'NHK総合', g2: 'NHK総合2', e1: 'NHK Eテレ', e3: 'NHK Eテレ3',
  s1: 'NHK BS', s2: 'NHK BS（102ch）', s5: 'NHK BSプレミアム4K',
};
export function parseNhk(data: unknown, shows: Show[]): Episode[] {
  const root = record(data);
  const episodes: Episode[] = [];
  let recognized = false;
  for (const [service, channel] of Object.entries(CHANNELS)) {
    const block = record(root[service]);
    if (!Array.isArray(block.publication)) continue;
    recognized = true;
    for (const raw of block.publication) {
      const item = record(raw);
      const title = text(item.name);
      const start = text(item.startDate);
      const show = shows.find(s => s.source === 'nhk' && s.aliases.some(alias => normalize(title).includes(normalize(alias))));
      if (!show) continue;
      if (!title || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) || !Number.isFinite(Date.parse(start))) throw new Error('NHK放送データの形式が変わっています');
      const day = jstDay(new Date(start));
      const providerId = text(item.identifier) || text(item.id) || text(item['@id']);
      episodes.push({
        id: `nhk:${service}:${providerId || `${show.id}:${start}`}`,
        showId: show.id, source: 'nhk', title: title.slice(0, 180), start, dateOnly: false,
        channel, rerun: /[［[【]再[］\]】]|再放送/.test(title),
        url: officialUrl(item.url, 'nhk.jp') || officialUrl(item.url, 'nhk.or.jp'),
        expiresAt: expiry(day),
      });
    }
  }
  if (!recognized) throw new Error('NHK v3のレスポンス形式を確認してください（publicationが見つかりません）');
  const distinct = new Map<string, Episode>();
  for (const e of episodes) {
    const service = e.id.split(':')[1];
    const family = service === 's5' ? 's5' : service.slice(0, 1);
    const key = `${family}|${e.showId}|${e.start}|${normalize(e.title)}`;
    if (!distinct.has(key)) distinct.set(key, e);
  }
  return [...distinct.values()];
}
export function parseTbs(html: string): Episode[] {
  const $ = load(html);
  const episodes: Episode[] = [];
  const add = (day: string, title: string) => {
    if (!title.trim()) throw new Error('TBSの見出しが取得できません');
    episodes.push({ id: `tbs:${day}`, showId: 'tbs-heritage', source: 'tbs', title: title.trim().slice(0, 180), start: day, dateOnly: true, channel: 'TBS（関東）', rerun: /再放送|[［[【]再[］\]】]/.test(title), url: 'https://www.tbs.co.jp/heritage/next/', expiresAt: expiry(day) });
  };
  const match = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec($('#next-date').text());
  if (!match) throw new Error('TBSの次回予告ページの形式が変わっています');
  add(parseDate(`${match[1]}-${match[2]}-${match[3]}`), $('#next-epname').text());
  $('#next-lineup li').each((_, node) => {
    const day = $(node).find('.date').text().trim();
    if (day) add(parseDate(day), $(node).find('.ttl').text());
  });
  return [...new Map(episodes.map(e => [e.id, e])).values()];
}
export function parseNtv(data: unknown): Episode[] {
  if (!Array.isArray(data)) throw new Error('日テレの次回情報の形式が変わっています');
  return data.map(raw => {
    const item = record(raw);
    const day = parseDate(text(item.date));
    const guest = text(item.guest).replace(/^GUEST\s*[：:]\s*/i, '').trim();
    if (!guest) throw new Error('日テレのゲスト情報が取得できません');
    return { id: `ntv:${text(item.item_id) || day}`, showId: 'ntv-anothersky', source: 'ntv', title: `アナザースカイ：${guest}`.slice(0, 180), start: day, dateOnly: true, channel: '日本テレビ（関東）', rerun: /再放送/.test(guest), url: 'https://www.ntv.co.jp/anothersky/', expiresAt: expiry(day) };
  });
}
async function get(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'TV-Next-Personal/0.1' }, redirect: 'error' });
  } catch { throw new Error('取得先に接続できません（タイムアウト・通信エラー）'); }
  if (!response.ok) throw new Error(`取得先のHTTPエラー: ${response.status}`);
  return response;
}
export async function collect(source: Source, env: SourceEnv, shows: Show[], now: Date): Promise<Episode[]> {
  if (source === 'nhk') {
    if (!env.NHK_API_KEY) throw new Error('NHK_API_KEYが未設定です');
    const episodes: Episode[] = [];
    for (const day of dates(now)) {
      const url = new URL('https://program-api.nhk.jp/v3/papiPgDateTv');
      url.search = new URLSearchParams({ service: 'tv', area: env.NHK_AREA || '140', date: day, key: env.NHK_API_KEY }).toString();
      const response = await get(url.href);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('NHKからJSON以外の応答が届きました'); }
      episodes.push(...parseNhk(payload, shows));
    }
    return [...new Map(episodes.map(e => [e.id, e])).values()];
  }
  if (source === 'tbs') {
    if (env.ENABLE_TBS !== 'true') throw new Error('自動取得は無効です。利用条件確認後にENABLE_TBSをtrueにしてください');
    return parseTbs(await (await get('https://www.tbs.co.jp/heritage/next/')).text());
  }
  if (env.ENABLE_NTV !== 'true') throw new Error('自動取得は無効です。利用条件確認後にENABLE_NTVをtrueにしてください');
  const response = await get('https://www.ntv.co.jp/anothersky/next.json');
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('日テレからJSON以外の応答が届きました'); }
  return parseNtv(payload);
}
