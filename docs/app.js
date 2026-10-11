const $ = id => document.getElementById(id);
const LABELS = { nhk: 'NHK', tbs: 'TBS', ntv: '日本テレビ' };
const TITLES = ['弾丸!空港トンボがえりツアー', '地球ドラマチック', '世界ふれあい街歩き', '鉄オタ選手権', '世界遺産', 'アナザースカイ'];
const IDS = ['nhk-airport', 'nhk-dramatic', 'nhk-walk', 'nhk-train', 'tbs-heritage', 'ntv-anothersky'];
const PRESETS = TITLES.map((title, i) => ({ id: IDS[i], title, source: i < 4 ? 'nhk' : i === 4 ? 'tbs' : 'ntv', aliases: [title], enabled: true, includeReruns: false }));
let connection = null;
let config = null;
let connected = false;
let snapshot = { shows: structuredClone(PRESETS), episodes: [], statuses: [], subscriptions: [] };
let subscriptionId = null;
try {
  connection = JSON.parse(localStorage.getItem('tv-next-connection') || 'null');
  subscriptionId = localStorage.getItem('tv-next-subscription');
} catch { /* Storage can be unavailable in private browsing. */ }
function message(value, error = false) {
  $('message').textContent = value;
  $('message').classList.toggle('error', error);
  $('message').hidden = false;
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function tab(name) {
  for (const button of document.querySelectorAll('[data-tab]')) {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    $(`tab-${button.dataset.tab}`).hidden = !active;
  }
}
async function api(path, body, publicRequest = false) {
  if (!connection?.url || !connection?.token) throw new Error('先に「設定」でサーバーに接続してください。');
  const headers = { 'Content-Type': 'application/json' };
  if (!publicRequest) headers.Authorization = `Bearer ${connection.token}`;
  let response;
  try { response = await fetch(new URL(path, connection.url), { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('サーバーに接続できません。通信とWorker URL、FRONTEND_URL設定を確認してください。'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('サーバーの応答が不正です。Worker URLを確認してください。'); }
  if (!response.ok) throw new Error(result.error || `サーバーエラー: ${response.status}`);
  return result;
}
function controls() {
  $('connection-status').textContent = connected ? 'サーバー接続済み' : '未接続';
  $('refresh').disabled = !connected;
  $('restore').disabled = !connected;
  for (const control of $('add-show').querySelectorAll('input, button')) control.disabled = !connected;
  const supported = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hasDevice = snapshot.subscriptions.some(s => s.id === subscriptionId);
  $('enable-push').disabled = !connected || !supported || (ios && !installed);
  $('test-push').disabled = !connected || !hasDevice;
  $('disable-push').disabled = !connected || !hasDevice;
  $('push-status').textContent = ios && !installed ? 'iPhoneではホーム画面に追加し、追加したアイコンから開いてください。' : !supported ? 'このブラウザーではPush通知を利用できません。iPhoneの条件やブラウザーを確認してください。' : hasDevice ? 'この端末は通知先に登録されています。' : 'この端末の通知はまだ登録されていません。';
}
function renderEpisodes() {
  const episodes = snapshot.episodes.filter(e => {
    const show = snapshot.shows.find(s => s.id === e.showId);
    return show?.enabled && (!e.rerun || show.includeReruns);
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  $('episode-count').textContent = episodes.length;
  $('episodes').replaceChildren();
  if (!episodes.length) {
    const empty = element('div', undefined, 'empty');
    empty.append(element('div', '▣', 'empty-symbol'), element('h3', connected ? '次回の放送情報を待っています' : 'まずは、あなたのサーバーに接続しましょう'), element('p', connected ? 'まだ予定が見つからないか、取得設定が必要です。\n「設定」の取得元の状態をご確認ください。' : '登録する6番組は準備できています。\n接続と通知の設定は「設定」から行えます。'));
    const button = element('button', '設定を開く', 'secondary');
    button.addEventListener('click', () => tab('settings'));
    empty.append(button);
    $('episodes').append(empty);
  }
  for (const e of episodes) {
    const card = element('article', undefined, 'card episode');
    card.dataset.episodeId = e.id;
    const date = e.dateOnly ? new Date(`${e.start}T12:00:00+09:00`) : new Date(e.start);
    const time = element('div', undefined, 'episode-date');
    time.append(element('small', `${date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' })}曜日`), element('strong', date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })), element('span', e.dateOnly ? '時刻未取得' : date.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })));
    const content = element('div', undefined, 'episode-content');
    content.append(element('span', e.channel, `badge ${e.source}`), element('h3', e.title), element('p', snapshot.shows.find(s => s.id === e.showId)?.title || '', 'muted'));
    if (e.rerun) content.append(element('span', '再放送', 'badge'));
    if (e.url) {
      try {
        const url = new URL(e.url);
        const hosts = { nhk: ['nhk.jp', 'nhk.or.jp'], tbs: ['tbs.co.jp'], ntv: ['ntv.co.jp'] };
        if (url.protocol === 'https:' && hosts[e.source]?.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
          const link = element('a', '公式情報を見る ↗');
          link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
          content.append(link);
        }
      } catch { /* Untrusted URLs must not become links. */ }
    }
    if (e.dateOnly) content.append(element('p', '放送時刻は公式サイトをご確認ください。', 'muted'));
    card.append(time, content);
    $('episodes').append(card);
  }
  const checks = snapshot.statuses.map(s => s.checked_at).filter(Boolean).sort();
  $('updated').textContent = checks.length ? `最終チェック：${new Date(checks.at(-1)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / 一覧更新は取得処理を起動しません` : connected ? '取得はGitHub Actionsで実行します。初回チェック後に表示されます。' : '接続すると、取得した放送情報がここに並びます。';
}
async function saveShows(next) {
  await api('/api/settings', { shows: next });
  snapshot.shows = next;
  render();
  message('番組設定を保存しました。次回チェックから反映されます。');
}
function renderShows() {
  $('show-count').textContent = snapshot.shows.length;
  $('shows').replaceChildren();
  for (const show of snapshot.shows) {
    const card = element('article', undefined, 'card show-card');
    const info = element('div');
    info.append(element('span', LABELS[show.source], `badge ${show.source}`), element('h3', show.title));
    const options = element('div', undefined, 'show-options');
    for (const [key, label] of [['enabled', '通知する'], ['includeReruns', '再放送の表記も含める']]) {
      const input = element('input'); input.type = 'checkbox'; input.checked = show[key]; input.disabled = !connected;
      const field = element('label', undefined, 'check-label'); field.append(input, element('span', label));
      input.addEventListener('change', async () => {
        input.disabled = true;
        try { await saveShows(snapshot.shows.map(s => s.id === show.id ? { ...s, [key]: input.checked } : s)); }
        catch (e) { input.checked = show[key]; message(e.message, true); input.disabled = false; }
      });
      options.append(field);
    }
    info.append(options);
    const remove = element('button', '削除', 'delete-show'); remove.disabled = !connected; remove.setAttribute('aria-label', `${show.title}を削除`);
    remove.addEventListener('click', async () => {
      if (!confirm(`「${show.title}」を登録番組から削除しますか？`)) return;
      try { await saveShows(snapshot.shows.filter(s => s.id !== show.id)); } catch (e) { message(e.message, true); }
    });
    card.append(info, remove); $('shows').append(card);
  }
}
function renderSettings() {
  $('sources').replaceChildren();
  for (const source of ['nhk', 'tbs', 'ntv']) {
    const status = snapshot.statuses.find(s => s.source === source);
    const row = element('div', undefined, 'source-row');
    row.append(element('strong', LABELS[source]));
    row.append(element('p', status?.error || (status?.last_success ? '取得成功' : '未チェック'), status?.error ? 'problem' : ''));
    if (status?.last_success) row.append(element('p', `最終成功：${new Date(status.last_success).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`));
    $('sources').append(row);
  }
  $('devices').replaceChildren();
  for (const [i, device] of snapshot.subscriptions.entries()) {
    const row = element('div', undefined, 'device-row');
    row.append(element('span', `端末 ${i + 1}${device.id === subscriptionId ? '（この端末）' : ''} / ${new Date(device.created_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}`));
    if (device.id !== subscriptionId) {
      const remove = element('button', '登録解除', 'text-button');
      remove.addEventListener('click', async () => {
        if (!confirm('この端末への通知を停止しますか？')) return;
        try { await api('/api/unsubscribe', { id: device.id }); await refresh(); } catch (e) { message(e.message, true); }
      });
      row.append(remove);
    }
    $('devices').append(row);
  }
}
function notificationTarget() {
  if (!location.hash.startsWith('#episode=')) return;
  tab('next');
  let id;
  try { id = decodeURIComponent(location.hash.slice(9)); } catch { return; }
  const card = [...document.querySelectorAll('[data-episode-id]')].find(node => node.dataset.episodeId === id);
  if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('focused'); }
}
function render() { renderEpisodes(); renderShows(); renderSettings(); controls(); notificationTarget(); }
async function refresh() {
  snapshot = await api('/api/state');
  connected = true;
  render();
}
async function connect() {
  config = await api('/api/config', undefined, true);
  await refresh();
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => tab(button.dataset.tab));
$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  const before = connection;
  try {
    const url = new URL($('worker-url').value.trim());
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Worker URLはhttps://で始まるURLを入力してください。');
    if (url.username || url.password) throw new Error('Worker URLに認証情報を含めないでください。');
    const token = $('admin-token').value.trim();
    if (token.length < 32) throw new Error('接続キーは32文字以上必要です。');
    connection = { url: url.origin, token };
    await connect();
    if (before?.url !== connection.url || before?.token !== connection.token) {
      subscriptionId = null; localStorage.removeItem('tv-next-subscription');
    }
    localStorage.setItem('tv-next-connection', JSON.stringify(connection));
    controls(); message('サーバーに接続しました。次に、この端末の通知を設定してください。');
  } catch (e) { connection = before; connected = false; config = null; controls(); message(e.message, true); }
});
$('disconnect').addEventListener('click', () => {
  if (!confirm('この端末の接続設定を消しますか？通知を停止したい場合は、先に「この端末の通知を停止」を押してください。')) return;
  localStorage.removeItem('tv-next-connection');
  connection = null; config = null; connected = false;
  snapshot = { shows: structuredClone(PRESETS), episodes: [], statuses: [], subscriptions: [] };
  $('admin-token').value = ''; $('worker-url').value = '';
  render(); message('この端末の接続設定を削除しました。Push通知先の登録は変更していません。');
});
$('refresh').addEventListener('click', async () => { try { await refresh(); message('一覧を更新しました。'); } catch (e) { message(e.message, true); } });
$('add-show').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('show-title').value.trim();
  if (!title) return;
  if (snapshot.shows.some(s => s.title.normalize('NFKC') === title.normalize('NFKC'))) return message('その番組は登録済みです。', true);
  try {
    await saveShows([...snapshot.shows, { id: `custom-${crypto.randomUUID()}`, title, source: 'nhk', aliases: [title], enabled: true, includeReruns: false }]);
    $('show-title').value = '';
  } catch (e) { message(e.message, true); }
});
$('restore').addEventListener('click', async () => {
  const existing = new Set(snapshot.shows.map(s => s.id));
  try { await saveShows([...snapshot.shows, ...PRESETS.filter(s => !existing.has(s.id))]); } catch (e) { message(e.message, true); }
});
function publicKeyBytes(key) {
  const value = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(value, char => char.charCodeAt(0));
}
$('enable-push').addEventListener('click', async () => {
  try {
    if (!config || !connected) throw new Error('先にサーバーへ接続してください。');
    // Notification permission must be requested directly from the button gesture.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('通知が許可されませんでした。iPhoneの「設定」から、このアプリの通知を確認してください。');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.publicKey) });
    const result = await api('/api/subscribe', { subscription: subscription.toJSON() });
    subscriptionId = result.id; localStorage.setItem('tv-next-subscription', result.id);
    await refresh(); message('通知先を登録しました。初回チェックでは、すでに掲載されている今後の放送も通知します。');
  } catch (e) { message(e.message, true); }
});
$('disable-push').addEventListener('click', async () => {
  try {
    await api('/api/unsubscribe', { id: subscriptionId });
    const registration = await navigator.serviceWorker.ready;
    await (await registration.pushManager.getSubscription())?.unsubscribe();
    subscriptionId = null; localStorage.removeItem('tv-next-subscription');
    await refresh(); message('この端末への通知を停止しました。');
  } catch (e) { message(e.message, true); }
});
$('test-push').addEventListener('click', async () => {
  try { const result = await api('/api/test', { id: subscriptionId }); message(result.message); } catch (e) { message(e.message, true); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => message('PWAの登録に失敗しました。HTTPSでの公開と配置先を確認してください。', true));
render();
if (connection) {
  $('worker-url').value = connection.url; $('admin-token').value = connection.token;
  connect().catch(e => { connected = false; controls(); message(e.message, true); });
}
window.addEventListener('online', () => { if (connection) connect().catch(e => message(e.message, true)); });
window.addEventListener('hashchange', notificationTarget);
