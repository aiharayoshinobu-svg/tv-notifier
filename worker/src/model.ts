export type Source = 'nhk' | 'tbs' | 'ntv';
export interface Show {
  id: string;
  title: string;
  source: Source;
  aliases: string[];
  enabled: boolean;
  includeReruns: boolean;
}
export interface Episode {
  id: string;
  showId: string;
  source: Source;
  title: string;
  start: string;
  dateOnly: boolean;
  channel: string;
  rerun: boolean;
  url: string | null;
  expiresAt: string;
}
export interface Env {
  DB: D1Database;
  FRONTEND_URL: string;
  NHK_AREA: string;
  ENABLE_TBS: string;
  ENABLE_NTV: string;
  ADMIN_TOKEN: string;
  JOB_TOKEN: string;
  NHK_API_KEY?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}
export type SourceEnv = Pick<Env, 'NHK_API_KEY' | 'NHK_AREA' | 'ENABLE_TBS' | 'ENABLE_NTV'>;
export const PRESETS: Show[] = [
  { id: 'nhk-airport', title: '弾丸!空港トンボがえりツアー', source: 'nhk', aliases: ['弾丸!空港トンボがえりツアー'], enabled: true, includeReruns: false },
  { id: 'nhk-dramatic', title: '地球ドラマチック', source: 'nhk', aliases: ['地球ドラマチック'], enabled: true, includeReruns: false },
  { id: 'nhk-walk', title: '世界ふれあい街歩き', source: 'nhk', aliases: ['世界ふれあい街歩き'], enabled: true, includeReruns: false },
  { id: 'nhk-train', title: '鉄オタ選手権', source: 'nhk', aliases: ['鉄オタ選手権'], enabled: true, includeReruns: false },
  { id: 'tbs-heritage', title: '世界遺産', source: 'tbs', aliases: ['世界遺産'], enabled: true, includeReruns: false },
  { id: 'ntv-anothersky', title: 'アナザースカイ', source: 'ntv', aliases: ['アナザースカイ'], enabled: true, includeReruns: false },
];
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s!！・･?？:：[\]【】「」『』]/g, '');
}
export function jstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function dates(now: Date): string[] {
  const day = jstDay(now);
  return Array.from({ length: 8 }, (_, i) => new Date(Date.parse(`${day}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10));
}
export function parseDate(value: string): string {
  const match = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(value.trim());
  if (!match) throw new Error('放送日の形式が変わっています');
  const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  if (new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) throw new Error('無効な放送日です');
  return result;
}
export function expiry(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+09:00`) + 86400_000).toISOString();
}
export function officialUrl(value: unknown, host: string): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
  } catch { return null; }
}
export function isUpcoming(episode: Episode, now: Date): boolean {
  return episode.dateOnly ? episode.start >= jstDay(now) : Date.parse(episode.start) > now.getTime();
}
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function revision(episode: Episode): Promise<string> {
  return hash(JSON.stringify([episode.title, episode.start, episode.channel, episode.rerun]));
}
export function validateShows(input: unknown): Show[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error('番組は最大20件です');
  const seen = new Set<string>();
  return input.map(item => {
    const s = record(item);
    const id = text(s.id);
    const preset = PRESETS.find(p => p.id === id);
    const title = text(s.title).trim();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || seen.has(id)) throw new Error('番組IDが不正です');
    if (!preset && (!id.startsWith('custom-') || s.source !== 'nhk')) throw new Error('追加できるのはNHK番組です');
    if (!title || title.length > 80) throw new Error('番組名は1〜80文字です');
    if (typeof s.enabled !== 'boolean' || typeof s.includeReruns !== 'boolean') throw new Error('番組設定が不正です');
    seen.add(id);
    return { id, title: preset?.title ?? title, source: preset?.source ?? 'nhk', aliases: preset?.aliases ?? [title], enabled: s.enabled, includeReruns: s.includeReruns };
  });
}
