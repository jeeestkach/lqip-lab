/**
 * Запись поведения страницы: кадры экрана плюс вехи загрузки.
 *
 * Работает поверх протокола отладки уже запущенного браузера — ни Playwright,
 * ни Puppeteer не нужны. Профиль тот же, что у обычного окна, поэтому картина
 * совпадает с тем, что видит человек.
 *
 * Запуск:
 *   node tools/record-demo.mjs <адрес> <куда-класть-кадры> [секунд]
 *
 * Кадры складываются как frame-0000.jpg и далее; рядом ложится meta.json
 * с вехами и с фактическим временем каждого кадра — по нему потом строится
 * ровная частота.
 */

import fs from 'node:fs';
import path from 'node:path';

const [, , URL_ARG, OUT_DIR, SECONDS = '9'] = process.argv;
if (!URL_ARG || !OUT_DIR) {
  console.error('нужно: node tools/record-demo.mjs <адрес> <каталог> [секунд]');
  process.exit(2);
}

/** Ширина и высота окна записи. Совпадает с обычным ноутбучным экраном. */
const VIEW = { width: 1280, height: 800 };

/** Скорость прокрутки — пиксели в секунду. Взята как спокойное чтение витрины. */
const SCROLL_SPEED = 700;

/** Через сколько после загрузки начинать прокручивать. */
const SCROLL_DELAY_MS = 1800;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Открывает вкладку и возвращает соединение с ней. */
async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close(), targetId: targets.id };
}

const { send, on, close, targetId } = await connect();

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// Кеш выключаем: записываем ПЕРВЫЙ визит, ради него всё и затевалось.
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCache');
/*
 * Тот же узкий канал, что и в замере. На быстрой сети записи выходят
 * почти одинаковыми, и видео ничего не показывает: разницу между стратегиями
 * создаёт лишний круг за скриптами и данными, а он заметен только когда
 * канал узкий.
 */
if (process.env.NO_THROTTLE !== '1') {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 100_000 });
}
await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });

fs.mkdirSync(OUT_DIR, { recursive: true });
const frames = [];
on((msg) => {
  if (msg.method !== 'Page.screencastFrame') return;
  const n = frames.length;
  fs.writeFileSync(path.join(OUT_DIR, `frame-${String(n).padStart(4, '0')}.jpg`), Buffer.from(msg.params.data, 'base64'));
  frames.push({ n, t: msg.params.metadata.timestamp });
  void send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
});

const t0 = Date.now();
await send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
await send('Page.navigate', { url: URL_ARG });

/*
 * Прокрутка задаётся временем, а не шагами: человек тянет ленту непрерывно,
 * и рывками это выглядит неправдоподобно. Ровно поэтому же не берём
 * scrollBy в цикле — считаем позицию от прошедшего времени.
 */
await wait(SCROLL_DELAY_MS);
const scrollStart = Date.now();
const scrollFor = Number(SECONDS) * 1000 - SCROLL_DELAY_MS;
while (Date.now() - scrollStart < scrollFor) {
  const y = Math.round(((Date.now() - scrollStart) / 1000) * SCROLL_SPEED);
  await send('Runtime.evaluate', { expression: `scrollTo(0, ${y})` });
  await wait(40);
}

await send('Page.stopScreencast');

const marks = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    document: Math.round(performance.getEntriesByType('navigation')[0].responseEnd),
    firstPaint: Math.round((performance.getEntriesByType('paint').find(p=>p.name==='first-contentful-paint')||{}).startTime||0),
    cards: document.querySelectorAll('a[href^="/catalog"]').length,
    images: performance.getEntriesByType('resource').filter(e=>e.name.includes('/cdn/')).length,
    bytes: performance.getEntriesByType('resource').reduce((s,e)=>s+(e.transferSize||0),0),
  })`,
  returnByValue: true,
});

fs.writeFileSync(
  path.join(OUT_DIR, 'meta.json'),
  JSON.stringify({ url: URL_ARG, view: VIEW, scrollSpeed: SCROLL_SPEED, startedAt: t0, frames, marks: JSON.parse(marks.result.value) }, null, 2),
);

console.log(`${URL_ARG}: кадров ${frames.length}, ${JSON.stringify(JSON.parse(marks.result.value))}`);
await fetch(`http://127.0.0.1:9222/json/close/${targetId}`);
close();
