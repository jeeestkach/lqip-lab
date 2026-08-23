/**
 * Замер вех загрузки двух стратегий рендера.
 *
 * Наблюдатель внедряется ДО первого скрипта страницы, поэтому ловит момент,
 * когда карточка товара впервые оказалась на экране, — а не когда о ней узнал
 * фреймворк. Разница принципиальна: у серверного рендера карточки нарисованы
 * задолго до того, как выполнится хоть строка кода приложения.
 *
 * Каждый прогон — с чистым кешем и на новой вкладке: это первый визит,
 * ради которого всё и делается.
 *
 * Запуск: node tools/measure-render.mjs [прогонов]
 */

const RUNS = Number(process.argv[2] ?? 5);

/**
 * Ограничение канала.
 *
 * Без него сравнивать нечего: на быстрой сети обе стратегии показывают товар
 * за считаные миллисекунды, и разница тонет в шуме. Настоящая цена лишнего
 * круга «скачать скрипты, спросить данные» видна там, где канал узкий, —
 * то есть у большинства посетителей с телефона.
 *
 * Взято «медленное 4G»: 1,6 Мбит/с и задержка 150 мс на запрос.
 */
const NET = { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 100_000 };
const THROTTLE = process.env.NO_THROTTLE !== '1';
const BASE = 'https://lqip.nikita-morozov.ru';
const VIEW = { width: 1280, height: 800 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Наблюдатель, который поедет в страницу до её собственных скриптов. */
const PROBE = `
window.__marks = { cards: 0, photo: 0 };
(function () {
  function tick() {
    if (!window.__marks.cards) {
      var a = document.querySelector('a[href^="/catalog"]');
      if (a) { var r = a.getBoundingClientRect(); if (r.height > 0 && r.top < innerHeight) window.__marks.cards = Math.round(performance.now()); }
    }
    if (!window.__marks.photo) {
      var imgs = document.querySelectorAll('img[src*="/cdn/"]');
      for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].complete && imgs[i].naturalWidth > 0) { window.__marks.photo = Math.round(performance.now()); break; }
      }
    }
    if (!window.__marks.cards || !window.__marks.photo) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
`;

async function connect() {
  const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { send, close: () => ws.close(), targetId: t.id };
}

/** Один прогон одной страницы с чистым кешем. */
async function run(path) {
  const { send, close, targetId } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.clearBrowserCache');
  if (THROTTLE) await send('Network.emulateNetworkConditions', NET);
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await send('Page.navigate', { url: BASE + path });
  await wait(THROTTLE ? 25000 : 6000);
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      ...window.__marks,
      document: Math.round(performance.getEntriesByType('navigation')[0].responseEnd),
      paint: Math.round((performance.getEntriesByType('paint').find(p=>p.name==='first-contentful-paint')||{}).startTime||0),
      docBytes: performance.getEntriesByType('navigation')[0].transferSize,
      jsBytes: performance.getEntriesByType('resource').filter(e=>/\\.m?js(\\?|$)/.test(e.name)).reduce((s,e)=>s+(e.transferSize||0),0),
      imgBytes: performance.getEntriesByType('resource').filter(e=>e.name.includes('/cdn/')).reduce((s,e)=>s+(e.transferSize||0),0),
      imgCount: performance.getEntriesByType('resource').filter(e=>e.name.includes('/cdn/')).length,
      apiCount: performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).length,
    })`,
  });
  await fetch(`http://127.0.0.1:9222/json/close/${targetId}`);
  close();
  return JSON.parse(r.result.value);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = {};
for (const [name, path] of [['csr', '/demo/csr'], ['ssr', '/demo/ssr']]) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) rows.push(await run(path));
  out[name] = Object.fromEntries(Object.keys(rows[0]).map((k) => [k, med(rows.map((r) => r[k]))]));
  console.log(`${name}:`, JSON.stringify(out[name]));
}
console.log('\nМЕДИАНЫ ПО', RUNS, 'ПРОГОНАМ, первый визит, кеш пуст' + (THROTTLE ? ', канал 1,6 Мбит/с, задержка 150 мс' : ', канал без ограничений') + '\n');
const rows = [
  ['документ получен', 'document', 'мс'],
  ['первый пиксель', 'paint', 'мс'],
  ['ТОВАР ВИДЕН', 'cards', 'мс'],
  ['первая фотография', 'photo', 'мс'],
  ['документ', 'docBytes', 'B'],
  ['скрипты', 'jsBytes', 'B'],
  ['снимков запрошено', 'imgCount', ''],
  ['запросов к API', 'apiCount', ''],
];
console.log('  показатель'.padEnd(24), 'клиентский'.padStart(12), 'серверный'.padStart(12));
for (const [label, key, unit] of rows) {
  console.log(`  ${label.padEnd(22)} ${String(out.csr[key]).padStart(12)} ${String(out.ssr[key]).padStart(12)}  ${unit}`);
}
