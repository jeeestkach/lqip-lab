/**
 * Разбор того, из чего складывается время до документа и до первого пикселя.
 *
 * Два сценария, оба настоящие:
 *   · «первый визит» — кеш очищен, соединения нет;
 *   · «повторный заход» — браузер ЗАКРЫТ и открыт заново. Не новая вкладка:
 *     при перезапуске теряется всё, что жило в памяти процесса, и остаётся
 *     только дисковый кеш. Именно это и происходит у человека, который закрыл
 *     браузер и вернулся назавтра.
 *
 * Перезапуск настоящий: процесс убивается и поднимается заново. Браузер для
 * замера ОТДЕЛЬНЫЙ — свой порт и одноразовый профиль; рабочее окно с вкладками
 * не трогается вовсе.
 *
 * Запуск: node tools/measure-arrival.mjs [прогонов]
 */

// Аргументами массивом, без оболочки: путь к скрипту собирается из переменной
// окружения, и подставлять его в командную строку незачем.
import { execFileSync, spawn } from 'node:child_process';

const RUNS = Number(process.argv[2] ?? 3);
const BASE = 'https://lqip.nikita-morozov.ru';
const VIEW = { width: 1280, height: 800 };

/** Медленное 4G — на быстром канале разница между стратегиями не видна. */
const NET = { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 100_000 };

/**
 * ОТДЕЛЬНЫЙ браузер для замера — свой порт и одноразовый профиль.
 *
 * Рабочий браузер не трогаем вовсе: сценарий требует перезапускать его
 * по нескольку раз, а это закрыло бы чужие вкладки. Заодно чище замер —
 * ни расширений, ни прогретых соединений от посторонних сайтов.
 */
const PORT = 9333;
const PROFILE = '/tmp/lqip-measure-profile';
const CHROME = process.env.ESTATE_CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ждёт, пока отладочный порт начнёт отвечать. */
async function waitForBrowser(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch {
      // ещё не поднялся
    }
    await wait(500);
  }
  throw new Error('браузер не поднялся');
}

/** Закрывает замерочный браузер и поднимает заново — так теряется вся память процесса. */
async function restartBrowser() {
  try {
    execFileSync('pkill', ['-f', `user-data-dir=${PROFILE}`], { stdio: 'ignore' });
  } catch {
    // не запущен — ничего страшного
  }
  await wait(2000);
  spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--headless=new',
    'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  await waitForBrowser();
  await wait(1200);
}

async function connect() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method) events.push(m);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, events, close: () => ws.close(), targetId: t.id };
}

/**
 * Один прогон.
 * @param path Путь страницы.
 * @param cold Очищать ли кеш перед заходом.
 */
async function run(path, cold) {
  const { send, events, close, targetId } = await connect();
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  if (cold) {
    await send('Network.clearBrowserCache');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  await send('Network.emulateNetworkConditions', NET);
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + path });
  await wait(9000);

  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const p = performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint');
      const R = performance.getEntriesByType('resource');
      return JSON.stringify({
        dns: Math.round(n.domainLookupEnd - n.domainLookupStart),
        tcp: Math.round(n.connectEnd - n.connectStart),
        tls: n.secureConnectionStart ? Math.round(n.connectEnd - n.secureConnectionStart) : 0,
        ttfb: Math.round(n.responseStart - n.requestStart),
        download: Math.round(n.responseEnd - n.responseStart),
        docDone: Math.round(n.responseEnd),
        paint: Math.round(p ? p.startTime : 0),
        docBytes: n.transferSize,
        fromCache: n.transferSize === 0 || n.transferSize < 300,
        cssBlocking: R.filter(e => e.initiatorType === 'link').length,
        jsBytes: R.filter(e => /\\.m?js(\\?|$)/.test(e.name)).reduce((s,e) => s + (e.transferSize||0), 0),
        imgFromNetwork: R.filter(e => e.name.includes('/cdn/') && (e.transferSize||0) > 300).length,
        imgTotal: R.filter(e => e.name.includes('/cdn/')).length,
      });
    })()`,
  });

  // Протокол берём из события: performance его не показывает.
  const resp = events.find((e) => e.method === 'Network.responseReceived' && e.params.response.url.includes(path));
  const protocol = resp?.params.response.protocol ?? '?';

  await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`);
  close();
  return { ...JSON.parse(r.result.value), protocol };
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Поднимаем свой браузер до начала: дальше он перезапускается сам.
await restartBrowser();

const results = {};
for (const [name, path] of [['csr', '/demo/csr'], ['ssr', '/demo/ssr']]) {
  /*
   * Первый визит — с перезапуском браузера ПЕРЕД КАЖДЫМ прогоном.
   *
   * Без этого второй и третий заходы переиспользуют уже открытое соединение,
   * и поиск имени с рукопожатием показывают ноль: медиана врёт про самое
   * дорогое, что есть у настоящего первого визита.
   */
  const cold = [];
  for (let i = 0; i < RUNS; i++) {
    await restartBrowser();
    cold.push(await run(path, true));
  }

  // ── повторный: прогреваем кеш, затем ЗАКРЫВАЕМ и открываем браузер
  await run(path, false);
  await restartBrowser();
  const warm = [];
  for (let i = 0; i < RUNS; i++) {
    warm.push(await run(path, false));
    if (i < RUNS - 1) await restartBrowser();
  }

  const fold = (rows) =>
    Object.fromEntries(
      Object.keys(rows[0])
        .filter((k) => typeof rows[0][k] === 'number')
        .map((k) => [k, med(rows.map((r) => r[k]))]),
    );
  results[name] = { cold: { ...fold(cold), protocol: cold[0].protocol }, warm: { ...fold(warm), protocol: warm[0].protocol } };
}

const line = (label, key, unit = 'мс') =>
  `  ${label.padEnd(26)} ${String(results.csr.cold[key]).padStart(8)} ${String(results.ssr.cold[key]).padStart(8)}   |${String(results.csr.warm[key]).padStart(8)} ${String(results.ssr.warm[key]).padStart(8)}  ${unit}`;

console.log(`\nМЕДИАНЫ ПО ${RUNS} ПРОГОНАМ, канал 1,6 Мбит/с, задержка 150 мс`);
console.log(`Протокол: ${results.ssr.cold.protocol}\n`);
console.log('                              ПЕРВЫЙ ВИЗИТ      | ПОСЛЕ ПЕРЕЗАПУСКА БРАУЗЕРА');
console.log('                           клиент.  сервер.   |  клиент.  сервер.');
console.log(line('поиск имени (DNS)', 'dns'));
console.log(line('соединение (TCP)', 'tcp'));
console.log(line('из них шифрование', 'tls'));
console.log(line('сервер думал (TTFB)', 'ttfb'));
console.log(line('передача тела', 'download'));
console.log(line('ДОКУМЕНТ ПОЛУЧЕН', 'docDone'));
console.log(line('ПЕРВЫЙ ПИКСЕЛЬ', 'paint'));
console.log(line('вес документа', 'docBytes', 'B'));
console.log(line('скрипты', 'jsBytes', 'B'));
console.log(line('снимков из сети', 'imgFromNetwork', 'шт'));
console.log(line('снимков всего', 'imgTotal', 'шт'));

// Убираем за собой: замерочный браузер и его профиль больше не нужны.
try { execFileSync('pkill', ['-f', `user-data-dir=${PROFILE}`], { stdio: 'ignore' }); } catch { /* уже закрыт */ }
