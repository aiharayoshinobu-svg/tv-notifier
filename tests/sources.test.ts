import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, dates, expiry, isUpcoming, normalize, officialUrl, parseDate, revision, validateShows } from '../worker/src/model';
import { parseNhk, parseTbs, parseNtv } from '../worker/src/sources';

const sample = { identifier: 'event-1', name: '地球ドラマチック　空の旅［再］', startDate: '2026-10-17T19:00:00+09:00', url: 'https://www.nhk.jp/p/example/' };
test('NHK v3 publicationを読み、横浜対象チャンネルだけを抽出し8Kを除く', () => {
  const episodes = parseNhk({ e1: { publication: [sample] }, s5: { publication: [{ ...sample, identifier: '4k', name: '鉄オタ選手権' }] }, s6: { publication: [sample] } }, PRESETS);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].rerun, true);
  assert.equal(episodes[1].channel, 'NHK BSプレミアム4K');
  assert.equal(episodes[0].url, sample.url);
});
test('タイトルの全角記号・空白を正規化して一致させる', () => {
  assert.equal(normalize('弾丸！ 空港トンボがえりツアー'), normalize(PRESETS[0].title));
  assert.equal(parseNhk({ g1: { publication: [{ ...sample, name: '弾丸！ 空港トンボがえりツアー　新作' }] } }, PRESETS).length, 1);
});
test('同時刻・同じ内容のNHKサブチャンネル放送を重複させない', () => {
  const episodes = parseNhk({ e1: { publication: [sample] }, e3: { publication: [{ ...sample, identifier: 'sub-channel' }] } }, PRESETS);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].channel, 'NHK Eテレ');
});
test('未知のNHK形式や日時を成功扱いにしない', () => {
  assert.throws(() => parseNhk({ list: [] }, PRESETS), /publication/);
  assert.throws(() => parseNhk({ e1: { publication: [{ ...sample, startDate: 'bad' }] } }, PRESETS));
  assert.deepEqual(parseNhk({ e1: { publication: [] } }, PRESETS), []);
});
test('プロバイダーIDがなくても同日の別放送を失わない', () => {
  const episodes = parseNhk({ e1: { publication: [{ ...sample, identifier: '' }, { ...sample, identifier: '', startDate: '2026-10-17T20:00:00+09:00' }] } }, PRESETS);
  assert.notEqual(episodes[0].id, episodes[1].id);
});
test('JSTの日付で当日から7日先の8日分を指定する', () => {
  assert.deepEqual(dates(new Date('2026-10-10T15:00:00Z')), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(expiry('2026-10-17'), '2026-10-17T15:00:00.000Z');
});
test('TBS次回・今後の放送予定を抽出し、日時を推測しない', () => {
  const html = '<p id="next-date"><span>2026</span>年<span>10</span>月<span>11</span>日放送</p><h2 id="next-epname">絶景 &amp; 世界遺産</h2><aside id="next-lineup"><li><dt class="date">2026.10.18</dt><dd class="ttl">カナダ</dd></li></aside>';
  const episodes = parseTbs(html);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].title, '絶景 & 世界遺産');
  assert.equal(episodes[0].start, '2026-10-11');
  assert.equal(episodes[0].dateOnly, true);
  assert.throws(() => parseTbs('<html></html>'));
});
test('日テレの公式JSONからゲストと放送日を抽出する', () => {
  const [episode] = parseNtv([{ date: '2026.10.17', guest: 'GUEST：相川七瀬', item_id: 'next-1', text: '転載しない長文', image: '使わない画像' }]);
  assert.equal(episode.title, 'アナザースカイ：相川七瀬');
  assert.equal(episode.start, '2026-10-17');
  assert.equal(episode.dateOnly, true);
  assert.throws(() => parseNtv({}));
  assert.throws(() => parseNtv([{ date: '2026.10.17' }]));
});
test('不正な日付を拒否し、日付のみの予定は当日中表示する', () => {
  assert.throws(() => parseDate('2026.02.30'));
  const [episode] = parseNtv([{ date: '2026.10.17', guest: 'ゲスト' }]);
  assert.equal(isUpcoming(episode, new Date('2026-10-17T14:59:00Z')), true);
  assert.equal(isUpcoming(episode, new Date('2026-10-17T15:00:00Z')), false);
});
test('同じ放送の変更を検出し、無関係なリンク変更では通知しない', async () => {
  const [episode] = parseNhk({ e1: { publication: [sample] } }, PRESETS);
  assert.equal(await revision(episode), await revision({ ...episode, url: null }));
  assert.notEqual(await revision(episode), await revision({ ...episode, start: '2026-10-17T20:00:00+09:00' }));
  assert.notEqual(await revision(episode), await revision({ ...episode, title: '変更された見出し' }));
});
test('番組設定は20件までで、民放追加や同一IDを拒否する', () => {
  assert.equal(validateShows(PRESETS).length, 6);
  assert.equal(validateShows([{ ...PRESETS[0], id: 'custom-test', title: 'NHKスペシャル' }])[0].title, 'NHKスペシャル');
  assert.throws(() => validateShows([...PRESETS, PRESETS[0]]));
  assert.throws(() => validateShows([{ ...PRESETS[4], id: 'custom-test' }]));
  assert.throws(() => validateShows(Array(21).fill(PRESETS[0])));
});
test('公式リンク以外・危険なURLを許可しない', () => {
  assert.equal(officialUrl('https://www.nhk.jp/p/abc', 'nhk.jp'), 'https://www.nhk.jp/p/abc');
  for (const url of ['javascript:alert(1)', 'https://nhk.jp.evil.example/', 'https://evilnhk.jp/', 'https://user:pass@nhk.jp/']) assert.equal(officialUrl(url, 'nhk.jp'), null);
});
test('PWAのパスはGitHub Pagesのリポジトリ配下にも対応する', () => {
  const manifest = JSON.parse(readFileSync(new URL('../docs/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(icon.src.startsWith('./'));
  assert.ok(readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8').includes('request.headers.has(\'Authorization\')'));
});
