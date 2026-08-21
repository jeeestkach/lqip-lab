/**
 * Сборка статической страницы-сравнения. Ничего не считает — только раскладывает
 * готовые артефакты из стратегий в HTML.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { lqipIntDecoderCss } from './lqip-format.mjs';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Убирает ключевые слова модульной системы, чтобы файл можно было склеить
 * с другими внутри одного `<script>`. Мини-сборщик на две строки: тянуть
 * настоящий бандлер ради трёх файлов без зависимостей смысла нет.
 * @param file Путь относительно src/.
 * @returns Текст файла, пригодный для инлайна.
 */
function inlineSource(file) {
  return readFileSync(path.join(SRC_DIR, file), 'utf8')
    .replace(/^export\s+/gm, '')
    .replace(/^import\s.*$/gm, '');
}

/**
 * Собирает браузерный скрипт демки: та же арифметика Oklab и упаковки бит,
 * что и на сервере, поэтому цифры в интерактиве сходятся со статическими блоками.
 */
function clientScript() {
  return [
    inlineSource('oklab.mjs'),
    inlineSource('lqip-format.mjs'),
    inlineSource('client/uploader.js'),
  ].join('\n');
}

/** Экранирует текст для вставки в HTML. */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Форматирует байты в читаемый вид. */
const fmt = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} КБ`);

/**
 * Во сколько раз плейсхолдер меньше оригинала.
 * @param bytes Вес плейсхолдера.
 * @param total Вес исходного файла.
 * @returns Строка вида `в 240× меньше`; крупные значения округляются, чтобы не создавать
 *   ложной точности — «в 13 500×» честнее, чем «в 13 490×».
 */
const times = (bytes, total) => {
  const t = total / bytes;
  const n =
    t >= 1000 ? Math.round(t / 100) * 100
    : t >= 100 ? Math.round(t / 10) * 10
    : t >= 10 ? Math.round(t)
    : Number(t.toFixed(1));
  // Разряды разделяем узким пробелом: «13 500» читается, «13500» — нет.
  return `в ${n.toLocaleString('ru-RU').replace(/ /g, ' ')}× меньше`;
};

/** Готовый блок кратности для подписи под карточкой. */
const savings = (bytes, total) => `<span class="pct">${times(bytes, total)}</span>`;

/**
 * Описывает все техники для одного изображения в едином виде.
 * @param r Результат анализа одного изображения.
 * @returns Массив описаний: как рисовать, сколько весит, нужен ли JS.
 */
function techniques(r) {
  const ratio = `${r.width} / ${r.height}`;

  return [
    {
      key: 'orig',
      title: 'Оригинал',
      sub: `${r.width}×${r.height}, ${r.format}`,
      bytes: r.originalBytes,
      bytesLabel: 'сам файл',
      js: null,
      ph: `<div class="ph" style="background-image:url('img/${esc(r.file)}');background-size:cover"></div>`,
      family: 'ref',
    },
    {
      key: 'color',
      title: 'Доминирующий цвет',
      sub: 'один hex, нижняя граница',
      bytes: r.dominant.bytes,
      bytesLabel: 'в разметке',
      js: false,
      ph: `<div class="ph" style="background-color:${esc(r.dominant.hex)}"></div>`,
      family: 'css',
      snippet: `<img src="photo.webp" width="${r.width}" height="${r.height}"\n     style="background-color:${r.dominant.hex}">`,
    },
    {
      key: 'int',
      title: 'Одно число (CSS-only)',
      sub: 'метод Lean Rada, 20 бит',
      bytes: r.lqipInt.bytes,
      bytesLabel: 'в разметке',
      js: false,
      ph: `<div class="ph ph-lqip-int" style="--lqip:${r.lqipInt.value};--lqip-fallback:${esc(r.lqipInt.fallbackHex)}"></div>`,
      family: 'css',
      snippet: `<!-- декодер CSS подключается один раз на всё приложение -->\n<img src="photo.webp" width="${r.width}" height="${r.height}"\n     class="ph-lqip-int" style="--lqip:${r.lqipInt.value}">`,
    },
    {
      key: 'grad',
      title: 'CSS-градиенты',
      sub: `${r.gradient.cellCount} radial-gradient из сетки 4×4`,
      bytes: r.gradient.bytes,
      bytesLabel: 'в разметке',
      js: false,
      ph: `<div class="ph" style="${esc(r.gradient.css)}"></div>`,
      family: 'css',
      // Все 16 слоёв в сниппете занимают полсотни строк и забивают страницу —
      // показываем первые два, остальные однотипны.
      snippet: (() => {
        const layers = r.gradient.backgroundImage.split('), ').map((s) => (s.endsWith(')') ? s : `${s})`));
        const shown = layers.slice(0, 2).join(',\n       ');
        return `<img src="photo.webp" width="${r.width}" height="${r.height}"\n     style="background-color:${r.gradient.backgroundColor};background-image:\n       ${shown},\n       /* … ещё ${layers.length - 2} таких же слоя, по одному на ячейку сетки */">`;
      })(),
    },
    {
      key: 'svg',
      title: 'SVG-сетка',
      sub: 'plaiceholder .svg, 6×6 + блюр',
      bytes: r.svg.bytes,
      bytesLabel: 'в разметке',
      js: false,
      ph: `<div class="ph" style="background-image:url('${esc(r.svg.dataUri)}');background-size:100% 100%"></div>`,
      family: 'css',
      snippet: `<img src="photo.webp" width="${r.width}" height="${r.height}"\n     style="background-image:url('data:image/svg+xml;base64,…');background-size:100% 100%">`,
    },
    {
      key: 'b64',
      title: 'base64 LQIP',
      sub: `WebP ${r.base64.primary.width} px, q${r.base64.primary.quality}`,
      bytes: r.base64.primary.bytes,
      bytesLabel: 'в разметке',
      js: false,
      ph: `<div class="ph blur" style="background-image:url('${esc(r.base64.primary.dataUri)}');background-size:cover"></div>`,
      family: 'css',
      recommended: true,
      snippet: `<img src="photo.webp" width="${r.width}" height="${r.height}"\n     style="background-image:url('${r.base64.primary.dataUri.slice(0, 48)}…');\n            background-size:cover">`,
    },
    {
      key: 'thumb',
      title: 'ThumbHash',
      sub: `хэш ${r.thumb.hashBytes} B → SSR-декод → WebP`,
      bytes: r.thumb.webpBytes,
      bytesLabel: 'в разметке после SSR-декода',
      altBytes: r.thumb.markupBytes,
      pngBytes: r.thumb.decodedBytes,
      js: true,
      ph: `<div class="ph blur" style="background-image:url('${esc(r.thumb.webpUri)}');background-size:cover"></div>`,
      family: 'hash',
      snippet: `// в БД лежит только это — ${r.thumb.hashBytes} B:\n// ${r.thumb.hashBase64}\n\n// на сервере при SSR: хэш → пиксели → WebP (${r.thumb.webpBytes} B)\nimport { thumbHashToRGBA } from 'thumbhash'\nconst { rgba, w, h } = thumbHashToRGBA(Buffer.from(hash, 'base64'))\nconst webp = await sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } })\n  .webp({ quality: 40 }).toBuffer()\n\n// thumbHashToDataURL() тоже есть, но отдаёт PNG — ${r.thumb.decodedBytes} B`,
    },
    {
      key: 'blur',
      title: 'BlurHash',
      sub: `${r.blur.markupBytes} симв. → SSR-декод → WebP`,
      bytes: r.blur.webpBytes,
      bytesLabel: 'в разметке после SSR-декода',
      altBytes: r.blur.markupBytes,
      pngBytes: r.blur.decodedBytes,
      js: true,
      ph: `<div class="ph blur" style="background-image:url('${esc(r.blur.webpUri)}');background-size:cover"></div>`,
      family: 'hash',
      snippet: `// в БД лежит только это — ${r.blur.markupBytes} симв.:\n// ${r.blur.hash}\n\n// на сервере при SSR: хэш → пиксели → WebP (${r.blur.webpBytes} B)\nimport { decode } from 'blurhash'\nconst rgba = decode(hash, 32, ${Math.round((r.height / r.width) * 32)})\nconst webp = await sharp(Buffer.from(rgba), { raw: { width: 32, height: ${Math.round((r.height / r.width) * 32)}, channels: 4 } })\n  .webp({ quality: 40 }).toBuffer()`,
    },
  ]
    .map((t) => ({ ...t, ratio, orig: r.originalBytes }))
    // Оригинал и рекомендованный вариант идут первыми во всех блоках: остальные
    // техники сравниваются глазом именно с ними, а не друг с другом.
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

/** Порядок карточек: оригинал, эталон, затем остальные по возрастанию сложности. */
const ORDER = ['orig', 'b64', 'color', 'int', 'grad', 'svg', 'thumb', 'blur'];

/**
 * Рисует одну карточку.
 * @param t Описание техники из techniques().
 * @param r Результат анализа изображения.
 * @param reveal Если true — поверх плейсхолдера проявляется оригинал (блок симуляции).
 *   Если false — карточка статична и показывает только плейсхолдер.
 */
function frameCard(t, r, reveal = false) {
  const badge = t.recommended ? '<span class="badge">рекомендую</span>' : '';
  const jsMark =
    t.js === null ? '' : t.js ? '<span class="chip chip-js">нужен JS</span>' : '<span class="chip chip-nojs">без JS</span>';

  const overlay =
    reveal && t.key !== 'orig'
      ? `<img class="real" data-src="img/${esc(r.file)}" alt="" width="${r.width}" height="${r.height}">`
      : '';

  return `<figure class="card${t.recommended ? ' card-rec' : ''}">
  <div class="frame" style="aspect-ratio:${t.ratio}">
    ${t.ph}
    ${overlay}
  </div>
  <figcaption>
    <div class="card-head"><b>${esc(t.title)}</b>${badge}</div>
    <div class="card-sub">${esc(t.sub)}</div>
    <div class="card-metrics"><span class="bytes">${fmt(t.bytes)}</span>${jsMark}</div>
    ${
      t.key === 'orig' ? '<div class="card-pct dim">базовая точка, ×1</div>'
      : t.key === 'none' ? '<div class="card-pct dim">ничего не добавляет</div>'
      : `<div class="card-pct">${savings(t.bytes, t.orig)}</div>`
    }
  </figcaption>
</figure>`;
}

/**
 * Пресеты скорости соединения. Числа — канонические профили троттлинга
 * Chrome DevTools, чтобы их можно было воспроизвести на вкладке Network.
 */
const SPEEDS = [
  { key: 'slow', label: 'Мобильный интернет', bps: 400_000, rtt: 400, hint: '3G, 400 Кбит/с · задержка 400 мс', def: true },
  { key: 'mid', label: 'Стандартный мобильный', bps: 1_600_000, rtt: 150, hint: '4G, 1,6 Мбит/с · задержка 150 мс' },
  { key: 'fast', label: 'Быстрый интернет', bps: 50_000_000, rtt: 20, hint: '50 Мбит/с · задержка 20 мс' },
];

/**
 * Считает, сколько реально грузится файл на заданной скорости.
 * @param bytes Вес файла в байтах.
 * @param speed Пресет из SPEEDS.
 * @returns Время в миллисекундах: передача плюс сетевая задержка.
 */
const loadMs = (bytes, speed) => Math.round(((bytes * 8) / speed.bps) * 1000 + speed.rtt);

/** Форматирует миллисекунды в читаемое время. */
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} с` : `${ms} мс`);

/** Рисует радиокнопки выбора скорости с посчитанным временем загрузки. */
function speedControls(bytes) {
  return SPEEDS.map((s) => {
    const ms = loadMs(bytes, s);
    return `<label class="speed">
  <input type="radio" name="speed" value="${s.key}" data-delay="${ms}"${s.def ? ' checked' : ''}>
  <span class="speed-body">
    <b>${esc(s.label)}</b>
    <span class="dim">${esc(s.hint)}</span>
    <span class="speed-time">≈ ${fmtMs(ms)}</span>
  </span>
</label>`;
  }).join('\n');
}

/**
 * Карточка-эталон «без плейсхолдера вообще» — пустая рамка.
 * Нужна в блоке симуляции: сравнивать техники надо не только между собой,
 * но и с тем, что происходит, если не делать ничего.
 * @param r Результат анализа изображения.
 */
function baseline(r) {
  return {
    key: 'none',
    title: 'Без плейсхолдера',
    sub: 'пустое место до загрузки',
    bytes: 0,
    js: null,
    ph: '<div class="ph ph-empty"></div>',
    ratio: `${r.width} / ${r.height}`,
    orig: r.originalBytes,
  };
}

/** Строка сравнительной таблицы. */
function tableRow(t) {
  if (t.key === 'orig') return '';
  const alt = t.altBytes
    ? `<br><span class="dim">сам хэш ${fmt(t.altBytes)}<br>декод в PNG ${fmt(t.pngBytes)}</span>`
    : '';
  return `<tr${t.recommended ? ' class="rec"' : ''}>
  <td>${esc(t.title)}</td>
  <td class="num">${fmt(t.bytes)}${alt}</td>
  <td class="num"><b class="pct">${times(t.bytes, t.orig)}</b></td>
  <td>${t.js ? '<span class="chip chip-js">да</span>' : '<span class="chip chip-nojs">нет</span>'}</td>
  <td class="dim">${esc(t.sub)}</td>
</tr>`;
}

/**
 * Собирает полную HTML-страницу.
 * @param results Массив результатов анализа; первый считается основным примером.
 * @returns Готовый HTML-документ.
 */
export function renderPage(results) {
  const main = results[0];
  const extra = results.slice(1);
  const t = techniques(main);

  // Оригинал как якорь в разменных сетках: без него не с чем сверять узнаваемость.
  const originalMini = `<figure class="mini mini-ref">
  <div class="frame" style="aspect-ratio:${main.width} / ${main.height}">
    <div class="ph" style="background-image:url('img/${esc(main.file)}');background-size:cover"></div>
  </div>
  <figcaption><b>оригинал</b><span class="bytes">${fmt(main.originalBytes)}</span></figcaption>
  <div class="card-pct dim">для сверки</div>
</figure>`;

  const ladder = main.base64.sizes
    .map(
      (s) => `<figure class="mini">
  <div class="frame" style="aspect-ratio:${main.width} / ${main.height}">
    <div class="ph blur" style="background-image:url('${esc(s.dataUri)}');background-size:cover"></div>
  </div>
  <figcaption><b>${s.width} px</b><span class="bytes">${fmt(s.bytes)}</span></figcaption>
  <div class="card-pct">${savings(s.bytes, main.originalBytes)}</div>
</figure>`,
    )
    .join('\n');

  const codecs = main.base64.codecs
    .map(
      (c) => `<figure class="mini">
  <div class="frame" style="aspect-ratio:${main.width} / ${main.height}">
    <div class="ph blur" style="background-image:url('${esc(c.dataUri)}');background-size:cover"></div>
  </div>
  <figcaption><b>${c.format.toUpperCase()}</b><span class="bytes">${fmt(c.bytes)}</span></figcaption>
  <div class="card-pct">${savings(c.bytes, main.originalBytes)}</div>
</figure>`,
    )
    .join('\n');

  const others = extra
    .map((r) => {
      const et = techniques(r);
      const pick = ['b64', 'color', 'int', 'grad'].map((k) => et.find((x) => x.key === k));
      return `<div class="other">
  <div class="other-grid">
    <figure class="mini"><div class="frame" style="aspect-ratio:${r.width} / ${r.height}">
      <div class="ph" style="background-image:url('img/${esc(r.file)}');background-size:cover"></div>
    </div><figcaption><b>оригинал</b><span class="bytes">${fmt(r.originalBytes)}</span></figcaption>
    <div class="card-pct dim">×1</div></figure>
    ${pick
      .map(
        (p) => `<figure class="mini"><div class="frame" style="aspect-ratio:${r.width} / ${r.height}">${p.ph}</div>
      <figcaption><b>${esc(p.title)}</b><span class="bytes">${fmt(p.bytes)}</span></figcaption>
      <div class="card-pct">${savings(p.bytes, r.originalBytes)}</div></figure>`,
      )
      .join('\n    ')}
  </div>
</div>`;
    })
    .join('\n');

  const details = t
    .filter((x) => x.snippet)
    .map(
      (x) => `<section class="detail">
  <div class="detail-visual">
    <div class="frame" style="aspect-ratio:${x.ratio}">${x.ph}</div>
  </div>
  <div class="detail-body">
    <h3>${esc(x.title)} <span class="bytes">${fmt(x.bytes)}</span> <span class="pct">${times(x.bytes, x.orig)}</span></h3>
    <p class="dim">${esc(x.sub)} · ${x.js ? 'требует JS-декодер' : 'рисуется первым пейнтом, без JS'}</p>
    <pre><code>${esc(x.snippet)}</code></pre>
  </div>
</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blur-плейсхолдеры изображений — сравнение техник</title>
<style>
${lqipIntDecoderCss()}

:root {
  --bg: #ffffff; --fg: #16181d; --dim: #6b7280; --line: #e5e7eb;
  --panel: #f8f9fb; --accent: #2563eb; --rec: #059669;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d0f13; --fg: #e8eaed; --dim: #9aa1ad; --line: #262a33;
          --panel: #14171d; --accent: #60a5fa; --rec: #34d399; }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 96px; }
h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.02em; }
h2 { font-size: 20px; margin: 56px 0 6px; letter-spacing: -0.01em; }
h3 { font-size: 16px; margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
p  { margin: 0 0 14px; max-width: 74ch; }
.lede { color: var(--dim); font-size: 16px; margin-bottom: 4px; }
.dim { color: var(--dim); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ——— рамка плейсхолдера ——— */
.frame {
  position: relative; overflow: hidden; border-radius: 10px;
  background: var(--panel); border: 1px solid var(--line);
}
.ph { position: absolute; inset: 0; background-position: center; }
/* Блюр «вытекает» за края — прячем его увеличением внутри overflow:hidden. */
.ph.blur { filter: blur(12px); transform: scale(1.12); }
.real {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0; transition: opacity .45s ease;
}
body[data-state="loaded"] .real[src] { opacity: 1; }

/* ——— карточки ——— */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 18px; margin-top: 20px; }
.card { margin: 0; }
.card-rec .frame { border-color: var(--rec); box-shadow: 0 0 0 2px color-mix(in oklab, var(--rec) 22%, transparent); }
figcaption { margin-top: 9px; font-size: 13px; }
.card-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.card-sub { color: var(--dim); font-size: 12px; margin-top: 1px; }
.card-metrics { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bytes { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--accent); font-weight: 600; }
.pct { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; color: var(--rec); font-weight: 600; }
.card-pct { margin-top: 3px; font-size: 11.5px; }
h3 .pct { font-weight: 600; }
.badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
  background: var(--rec); color: #fff; border-radius: 4px; padding: 2px 5px; font-weight: 700; }
.chip { font-size: 11px; border-radius: 999px; padding: 1px 8px; border: 1px solid var(--line); color: var(--dim); }
.chip-nojs { color: var(--rec); border-color: color-mix(in oklab, var(--rec) 40%, transparent); }
.chip-js { color: #d97706; border-color: color-mix(in oklab, #d97706 40%, transparent); }

/* Эталон «без плейсхолдера»: пустая рамка, а не серая заливка —
   иначе получился бы ещё один плейсхолдер, только цветом фона. */
.ph-empty { background: transparent; }

/* ——— панель управления ——— */
.controls {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin-top: 18px; padding: 14px 16px; border: 1px solid var(--line);
  border-radius: 10px; background: var(--panel);
}
.speeds { display: flex; gap: 10px; flex-wrap: wrap; flex: 1 1 auto; }
.speed {
  display: flex; align-items: flex-start; gap: 8px; cursor: pointer;
  padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg); font-size: 13px; color: var(--fg);
  transition: border-color .15s, box-shadow .15s;
}
.speed:hover { border-color: color-mix(in oklab, var(--accent) 45%, var(--line)); }
.speed:has(input:checked) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 20%, transparent);
}
.speed input { margin: 2px 0 0; accent-color: var(--accent); }
.speed-body { display: flex; flex-direction: column; gap: 1px; line-height: 1.35; }
.speed-body .dim { font-size: 11.5px; }
.speed-time { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px;
  color: var(--accent); font-weight: 600; }
button {
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: 0; border-radius: 7px; padding: 8px 16px;
}
button:hover { filter: brightness(1.08); }
label { font-size: 13px; color: var(--dim); display: flex; align-items: center; gap: 7px; }
select { font: inherit; font-size: 13px; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--bg); color: var(--fg); }

/* ——— таблица ——— */
.tablewrap { overflow-x: auto; margin-top: 18px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; min-width: 560px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); font-weight: 600; }
td.num { font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
tr.rec td { background: color-mix(in oklab, var(--rec) 8%, transparent); }

/* ——— мелкие сетки ——— */
.minis { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; margin-top: 18px; }
.mini { margin: 0; }
.mini figcaption { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.other { margin-top: 18px; }
.other-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }

/* ——— детали ——— */
.detail { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 22px; align-items: start;
  padding: 20px 0; border-bottom: 1px solid var(--line); }
/* Элемент grid по умолчанию не сжимается ниже min-content, поэтому длинный <pre>
   с кодом растягивал бы всю страницу вместо того, чтобы скроллиться внутри себя. */
.detail-body { min-width: 0; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px 14px; overflow: auto; max-height: 300px;
  font-size: 12.5px; line-height: 1.55; margin: 10px 0 0; }
.note { border-left: 3px solid var(--accent); background: var(--panel);
  padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; }

/* ——— блок 3: интерактивная загрузка ——— */
.dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 34px 20px; margin-top: 18px; cursor: pointer; text-align: center;
  border: 2px dashed var(--line); border-radius: 12px; background: var(--panel);
  transition: border-color .15s, background .15s;
}
.dropzone:hover, .dropzone.drag { border-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 7%, var(--panel)); }
.dropzone .dim { font-size: 13px; }
.upsummary { margin-top: 14px; padding: 11px 15px; border-radius: 8px; font-size: 14px;
  background: color-mix(in oklab, var(--rec) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--rec) 35%, transparent); }
.up-item { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
.up-name { font-weight: 600; margin-bottom: 10px; font-size: 14px; }
.up-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; max-width: 640px; }
.mini-best .frame { border-color: var(--rec);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--rec) 22%, transparent); }
.mini-ref .frame { border-style: dashed; }
.up-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; font-size: 13px; color: var(--dim); }
.up-meta code { background: var(--panel); border: 1px solid var(--line);
  border-radius: 4px; padding: 1px 5px; font-size: 12px; color: var(--fg); }

/* ——— замер стоимости обработки ——— */
.bench { margin: 18px 0; display: flex; flex-direction: column; gap: 7px; }
.bench-row { display: grid; grid-template-columns: 1fr auto; align-items: center;
  gap: 4px 12px; font-size: 13.5px; }
.bench-row b { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
.bench-row i { grid-column: 1 / -1; height: 6px; border-radius: 3px;
  background: color-mix(in oklab, var(--dim) 45%, transparent); min-width: 3px; }
.bench-fast b { color: var(--rec); }
.bench-fast i { background: var(--rec); }
.bench-slow b { color: #d97706; }
.bench-slow i { background: #d97706; }

/* ——— схема процесса ——— */
.pipe { margin: 20px 0; }
.pipe-lane { border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; background: var(--panel); }
.lane-sync { border-color: color-mix(in oklab, var(--rec) 45%, var(--line)); }
.lane-async { border-color: color-mix(in oklab, #d97706 40%, var(--line)); }
.lane-head { font-size: 13.5px; color: var(--dim); margin-bottom: 8px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lane-head b { color: var(--fg); font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
.lane-tag { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700;
  border-radius: 4px; padding: 2px 7px; background: var(--dim); color: var(--bg); }
.lane-tag-fast { background: var(--rec); color: #fff; }
.lane-tag-slow { background: #d97706; color: #fff; }
.lane-steps { margin: 0; padding-left: 20px; font-size: 14px; }
.lane-steps li { margin-bottom: 5px; }
.pipe-arrow { text-align: center; padding: 8px 0; color: var(--dim); font-size: 13px; }
.note b { color: var(--fg); }
ul { padding-left: 20px; max-width: 74ch; }
li { margin-bottom: 7px; }

@media (max-width: 720px) {
  .wrap { padding: 28px 16px 64px; }
  h1 { font-size: 24px; }
  .detail { grid-template-columns: minmax(0, 1fr); }
  h3 { flex-wrap: wrap; gap: 4px 8px; }
  .detail-visual { max-width: 180px; }
  .other-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
</head>
<body data-state="idle">
<div class="wrap">

<h1>Blur-плейсхолдеры изображений</h1>
<p class="lede">Что именно увидит клиент, пока грузится картинка — семь техник на одном изображении,
с настоящими байтами. Всё посчитано локально через sharp, thumbhash и blurhash.</p>

<h2>Входное изображение</h2>
<p class="dim">${esc(main.file)} · ${main.width}×${main.height} · ${main.format} · <b>${fmt(main.originalBytes)}</b> —
именно столько клиент ждёт, если плейсхолдера нет.</p>

<h2>Блок 1. Как выглядит блюр</h2>
<p>Статично: ровно то, что видит клиент, пока картинка ещё не пришла. Оригинал слева — для сверки.
Число под карточкой это вес, который техника добавляет <b>в сам HTML</b>.</p>

<div class="cards">
${t.map((x) => frameCard(x, main, false)).join('\n')}
</div>

<h2>Блок 2. Симуляция загрузки</h2>
<p>Здесь поверх плейсхолдера проявляется оригинал. Задержка не выдумана: она посчитана
из настоящего веса файла (<b>${fmt(main.originalBytes)}</b>) и выбранной скорости — время передачи плюс сетевая задержка.
Профили те же, что во вкладке Network в DevTools, так что результат можно перепроверить.</p>

<div class="controls">
  <div class="speeds">
${speedControls(main.originalBytes)}
  </div>
  <button id="replay">Воспроизвести загрузку</button>
</div>

<div class="cards">
${[baseline(main), ...t.filter((x) => x.key !== 'orig')].map((x) => frameCard(x, main, true)).join('\n')}
</div>

<p class="dim" style="margin-top:14px">Первая карточка — как это выглядит <b>без плейсхолдера вообще</b>.
Именно с ней и надо сравнивать: на быстром интернете разница почти незаметна, на мобильном —
это разница между «страница живая» и «страница сломалась».</p>

<div class="note">
<b>Замер оптимистичный, в жизни хуже.</b> Здесь одна картинка получает весь канал целиком.
На настоящей странице она стоит в очереди за CSS, шрифтами, скриптами и другими такими же картинками,
а перед передачей ещё случается промах кеша CDN и установка TLS-соединения.
Двадцать таких изображений на мобильном интернете — это уже десятки секунд до последнего,
и всё это время плейсхолдер держит вёрстку и показывает, что там будет.
</div>

<h2>Блок 3. Попробуйте на своём изображении</h2>
<p>Всё считается прямо здесь, в браузере, — ничего никуда не отправляется.
Можно бросить сразу пачку файлов: сверху появится суммарное время обработки.
Упаковка «одного числа» и цветовая арифметика — буквально тот же код, что и на сервере
(один модуль инлайнится в страницу), поэтому результат сопоставим с блоками выше.</p>

<div id="dropzone" class="dropzone">
  <b>Перетащите изображения сюда</b>
  <span class="dim">или нажмите, чтобы выбрать · можно несколько сразу</span>
  <input type="file" id="fileinput" accept="image/*" multiple hidden>
</div>
<div id="upsummary" class="upsummary" hidden></div>
<div id="upresults"></div>

<div class="note">
<b>Важно: браузерный кодировщик слабее серверного.</b> Canvas отдаёт WebP примерно втрое тяжелее,
чем sharp на том же изображении и том же качестве — на этой картинке около <b>1 КБ</b> против
<b>${fmt(main.base64.primary.bytes)}</b> в блоках выше. Разница не в алгоритме плейсхолдера, а в самом кодеке:
у <code>canvas.toDataURL</code> нет ни настроек метода сжатия, ни выбора пресета.
<br><br>
Практический вывод для сервиса загрузки: <b>браузер годится для предпросмотра, кодировать должен сервер.</b>
Отсюда же следует, что «посчитать плейсхолдер на клиенте и прислать готовым» — плохая идея:
получите втрое больший вес и никакого контроля над качеством.
<br><br>
С «одним числом» тоньше. Упаковка бит здесь буквально та же функция, что на сервере, но <i>выборка
пикселей</i> другая: у canvas свой ресемплер, у sharp — свой. На части снимков число совпадает с
серверным до единицы, на части отличается на один шаг квантования. Для 20 бит это норма, а не дефект:
на глаз разница неразличима. Но если вам нужна побитовая воспроизводимость — считайте на сервере.
</div>

<h2>Сравнение</h2>
<div class="tablewrap">
<table>
  <thead><tr><th>Техника</th><th>Вес в разметке</th><th>Меньше оригинала</th><th>Нужен JS</th><th>Что это</th></tr></thead>
  <tbody>
${t.map(tableRow).filter(Boolean).join('\n')}
  </tbody>
</table>
</div>

<div class="note">
<b>Осторожно с цифрами хэшей — их легко сравнить нечестно.</b>
Библиотеки отдают декод в <b>PNG</b> (${fmt(main.thumb.decodedBytes)} у ThumbHash и ${fmt(main.blur.decodedBytes)} у BlurHash).
Это формат без потерь, и ставить его рядом с WebP-плейсхолдером значит сравнивать кодеки, а не техники.
Пересжимаем декод в WebP тем же качеством — и получается ${fmt(main.thumb.webpBytes)} и ${fmt(main.blur.webpBytes)}.
Именно эти числа стоят в таблице выше.
</div>

<div class="note">
<b>И тогда главный вывод переворачивается: в байтах разметки спора нет.</b>
После честного пересжатия хэши дают ${fmt(main.thumb.webpBytes)}–${fmt(main.blur.webpBytes)},
а base64 LQIP сопоставимой детализации — ${fmt(main.base64.sizes[1].bytes)} на 12 px и
${fmt(main.base64.sizes[0].bytes)} на 8 px (лестница ниже). Это паритет: хэши сильнее сглажены,
поэтому лучше жмутся, но и деталей несут меньше. Выбирать по весу HTML тут не из чего.
<br><br>
Разница в другом, и она операционная. <b>LQIP</b> требует только sharp один раз при загрузке файла.
<b>Хэш</b> требует библиотеку на обоих концах и шаг декодирования на каждый рендер — зато в базе,
в JSON API и в мобильном клиенте он занимает ${fmt(main.thumb.markupBytes)} вместо ~200 B.
Клиентский декод — единственный случай, когда хэш реально экономит байты HTML, но тогда плейсхолдер
появляется после исполнения JS, то есть уже после первого пейнта, и в SSR теряет смысл.
</div>

<div class="note">
<b>Про «одно число» и цвет.</b> В опубликованной спецификации оси цветности кодируются в диапазоне ±0.35 —
он рассчитан на насыщенные цвета. Но у <i>среднего</i> цвета фотографии цветность почти всегда мала:
на этих снимках |a| и |b| выходят ${esc('0,01…0,08')}, а шаг квантования при ±0.35 равен 0.0875. Весь цвет умещается
внутри одного шага, и плейсхолдер схлопывается в нейтрально-серый. Здесь диапазон сужен до ±0.12 (шаг 0.03)
одновременно в кодере и в CSS-декодере — они генерируются из одной константы, поэтому всегда согласованы.
Плата: такой CSS несовместим с чужим, написанным под исходный диапазон.
</div>

<h2>Размен: размер уменьшенной копии</h2>
<p>WebP, качество 40. Видно, где узнаваемость перестаёт расти вместе с весом.</p>
<div class="minis">
${originalMini}
${ladder}
</div>

<h2>Размен: кодек</h2>
<p>Одинаковые ${main.base64.primary.width} px, сопоставимое качество. AVIF на таких крошечных размерах
обычно проигрывает — заголовок контейнера съедает выигрыш кодека.</p>
<div class="minis">
${originalMini}
${codecs}
</div>

<h2>Из чего состоит base64 LQIP</h2>
<p>Никакой магии, четыре шага. Ничего не декодируется скриптом — всё делает сам браузер.</p>

<div class="pipe">
  <div class="pipe-lane">
    <ol class="lane-steps">
      <li><b>Уменьшаем оригинал до ${main.base64.primary.width} px по ширине.</b>
        ${main.width}×${main.height} → ${main.base64.primary.width}×${Math.round((main.height / main.width) * main.base64.primary.width)}.
        Это уже не изображение, а «пятно цвета» — но пятно правильное.</li>
      <li><b>Кодируем в WebP с качеством ${main.base64.primary.quality}.</b>
        Получается ${fmt(main.base64.primary.rawBytes)} двоичных данных.</li>
      <li><b>Переводим в base64.</b> Текст на треть длиннее двоичного —
        итого ${fmt(main.base64.primary.bytes)} вместе с префиксом <code>data:image/webp;base64,</code>.</li>
      <li><b>Кладём фоном на сам <code>&lt;img&gt;</code></b> с <code>background-size:cover</code>.
        Браузер растягивает ${main.base64.primary.width} пикселей на всю ширину блока — и <b>размытие получается само собой</b>,
        просто из-за сглаживания при увеличении. Отдельный <code>filter:blur()</code> нужен лишь для того,
        чтобы спрятать квадратики на краях.</li>
    </ol>
  </div>
</div>

<p>Когда настоящий файл догрузился, браузер рисует его <b>поверх</b> фона — тот остаётся под картинкой.
Подменять ничего не надо, JS не участвует. Побочная польза: если картинка не загрузится вовсе,
на месте останется размытое пятно, а не битая иконка.</p>

<h2>Плейсхолдер и srcset уживаются, SEO не страдает</h2>

<p>Это разные роли, и они не конкурируют. <b>srcset</b> — список настоящих файлов, из которых браузер
выбирает <i>один</i> под экран и плотность пикселей. <b>Плейсхолдер</b> — то, что видно, пока выбранный файл едет.
Технически data-URI в <code>srcset</code> вписать можно, но это ошибка по смыслу: браузер возьмёт его
как окончательную картинку и на узком экране навсегда покажет размытое пятно вместо фотографии.</p>

<p>Правильная разметка — обычный <code>&lt;img&gt;</code>, где плейсхолдер живёт в <code>style</code>,
и <b>ничего для SEO не теряется</b>:</p>

<pre><code>${esc(`<img
  src="photo-1280.webp"
  srcset="photo-320.webp   320w,
          photo-640.webp   640w,
          photo-1280.webp 1280w,
          photo-2560.webp 2560w"
  sizes="(max-width: 700px) 100vw, 640px"
  width="${main.width}" height="${main.height}"
  alt="Осмысленное описание картинки"
  decoding="async"
  style="background-image:url('data:image/webp;base64,…');
         background-size:cover">`)}</code></pre>

<p>Здесь есть всё, что индексируется: настоящий тег <code>&lt;img&gt;</code>, <code>src</code>,
<code>srcset</code> и <code>alt</code>. Атрибут <code>style</code> для поиска по картинкам — просто оформление,
он не конкурирует с <code>src</code> и не мешает индексации.</p>

<h3 style="margin-top:32px">Почему нельзя просто положить его в srcset</h3>

<p>Соблазн понятный: раз это картинка, пусть будет ещё одним кандидатом. Но <b>srcset выбирает
ровно один вариант и показывает только его</b>. Это механизм выбора разрешения, а не очерёдности:
в нём вообще нет измерения «время». Напишем так:</p>

<pre><code>${esc(`<!-- так делать не надо -->
<img srcset="data:image/webp;base64,…   20w,
             photo-1280.webp          1280w"
     sizes="640px">`)}</code></pre>

<p>Браузер считает: под слот нужно ~640 px, кандидаты 20w и 1280w, беру 1280w.
<b>Плейсхолдер не покажется никогда</b> — он просто лежит мёртвым весом в HTML.
А если слот всё-таки окажется уже 20 px, браузер возьмёт размытое пятно и оставит его
насовсем: «догрузить получше» srcset не умеет.</p>

<div class="note">
<b>Суть в том, что нужны два слоя, а не два кандидата.</b>
У одного и того же <code>&lt;img&gt;</code> фон и содержимое — <b>разные слои отрисовки</b>.
Фон это inline-данные, рисуется мгновенно, без сетевого запроса. Содержимое приезжает по сети
и рисуется <i>поверх</i>. Два слоя дают последовательность: сначала пятно, потом фотография.
<br><br>
<code>srcset</code> же — один слой и один выбор. По той же причине не помогут ни
<code>&lt;picture&gt;</code> с <code>&lt;source&gt;</code>, ни CSS-функция <code>image-set()</code>:
все трое отвечают на вопрос «какой файл взять», а не «что показать, пока он едет».
</div>

<p>Ближайшее, что умеет сам формат, — <b>прогрессивный JPEG</b>: один файл, который проявляется
по мере прихода байтов. Но он не спасает от главного, ради чего всё затевалось: пока не пришёл
первый байт, показывать всё равно нечего. Плейсхолдер работает <i>до</i> начала загрузки — потому
он и должен быть уже в HTML.</p>

<div class="note">
<b>Откуда взялся миф про SEO.</b> Регресс возникает не от плейсхолдера, а от <b>подмены самого тега</b>:
если настоящую картинку показывать как <code>&lt;div style="background-image:url(photo.webp)"&gt;</code>,
то нет ни <code>alt</code>, ни <code>srcset</code>, и поиск по картинкам такое не индексирует.
Плейсхолдер фоном <b>на <code>&lt;img&gt;</code></b> — совсем другое дело: тег остаётся полноценным.
Правило простое: <b>фоном может быть только плейсхолдер, но никогда — сам контент.</b>
</div>

<div class="note">
<b>Две ловушки, о которых узнаёшь поздно.</b>
<ul style="margin:8px 0 0">
  <li><b>Прозрачность.</b> У PNG с альфа-каналом фон будет просвечивать сквозь прозрачные места
      и после загрузки. Для таких изображений плейсхолдер либо не нужен, либо снимается по <code>load</code>.</li>
  <li><b><code>object-fit</code>.</b> Если на картинке стоит <code>object-fit:contain</code>, содержимое
      займёт не всю рамку, а фон растянут на всю — по краям останется размытая полоса.
      Держите <code>background-size</code> согласованным с <code>object-fit</code>.</li>
</ul>
</div>

<h2>Как это вставлять</h2>
<p>Плейсхолдер вешается фоном на <b>сам <code>&lt;img&gt;</code></b>, а не в соседний <code>&lt;div&gt;</code>:
не нужен лишний элемент, и при загрузке картинка накрывает фон без мигания.
Атрибуты <code>width</code>/<code>height</code> обязательны — без них будет сдвиг вёрстки, и весь смысл теряется.</p>
${details}

${
  extra.length
    ? `<h2>На других изображениях</h2>
<p class="dim">Слева оригинал, дальше — доминирующий цвет, одно число, CSS-градиенты, base64 LQIP.</p>
${others}`
    : ''
}

<h2>Схема: как устроить загрузку и обработку</h2>
<p>Главный вопрос — что делать в самом запросе загрузки, а что отложить. Ответ даётся замером
(sharp, эта картинка 1200×1697, Node 26 на Apple Silicon):</p>

<div class="bench">
  <div class="bench-row"><span>метаданные (width/height)</span><b>0,3 мс</b><i style="width:1%"></i></div>
  <div class="bench-row bench-fast"><span>плейсхолдер 20 px → WebP</span><b>10 мс</b><i style="width:1%"></i></div>
  <div class="bench-row"><span>производная 320 px WebP</span><b>31 мс</b><i style="width:2%"></i></div>
  <div class="bench-row"><span>производная 1280 px WebP</span><b>231 мс</b><i style="width:12%"></i></div>
  <div class="bench-row bench-slow"><span>производная 1280 px AVIF</span><b>1991 мс</b><i style="width:100%"></i></div>
</div>
<p class="dim">AVIF дороже плейсхолдера почти в <b>200 раз</b>. Отсюда и проходит граница:
плейсхолдер успевает посчитаться внутри запроса, тяжёлые производные — нет.</p>

<div class="pipe">
  <div class="pipe-lane lane-sync">
    <div class="lane-head"><span class="lane-tag lane-tag-fast">синхронно</span>
      в том же HTTP-запросе <b>~11 мс</b></div>
    <ol class="lane-steps">
      <li><b>Приём файла.</b> Проверка типа по сигнатуре, а не по расширению; лимит размера.</li>
      <li><b>Оригинал → объектное хранилище</b> (S3/MinIO). Ключ по хешу содержимого — дубликаты бесплатны.</li>
      <li><b>sharp:</b> метаданные + плейсхолдер 20 px WebP. Это те самые 10 мс.</li>
      <li><b>Одна транзакция в БД:</b> ключ объекта, width, height и плейсхолдер пишутся вместе.</li>
      <li><b>Ответ клиенту.</b> Запись уже пригодна к рендеру — производные не нужны.</li>
    </ol>
  </div>

  <div class="pipe-arrow">ставим задачу в очередь ↓</div>

  <div class="pipe-lane lane-async">
    <div class="lane-head"><span class="lane-tag lane-tag-slow">асинхронно</span>
      очередь воркеров <b>секунды</b></div>
    <ol class="lane-steps" start="6">
      <li><b>Производные размеры:</b> 320 / 640 / 1280 / 2560, WebP и AVIF.</li>
      <li><b>Пометка в БД:</b> производные готовы. До этого момента отдаём оригинал —
        плейсхолдер уже есть, клиент ничего не теряет.</li>
    </ol>
  </div>

  <div class="pipe-arrow">↓</div>

  <div class="pipe-lane lane-render">
    <div class="lane-head"><span class="lane-tag">рендер</span> SSR, на каждый запрос страницы</div>
    <ol class="lane-steps" start="8">
      <li><b>Читаем строку из БД</b> — плейсхолдер уже лежит там строкой, считать нечего.</li>
      <li><b>Отдаём <code>&lt;img&gt;</code></b> с плейсхолдером в <code>style</code> и с <code>width</code>/<code>height</code>.</li>
      <li><b>Первый пейнт:</b> блюр виден сразу, вёрстка не прыгает, настоящий файл догружается следом.</li>
    </ol>
  </div>
</div>

<div class="note">
<b>Четыре правила, которые ломаются чаще всего.</b>
<ul style="margin:8px 0 0">
  <li><b>Плейсхолдер и ключ объекта пишутся одной транзакцией.</b> Иначе гонка: страница успевает
      отрендерить запись, у которой картинка есть, а плейсхолдера ещё нет — и весь эффект теряется
      ровно на тех записях, что загружены только что.</li>
  <li><b>width и height — в ту же строку.</b> Без них будет сдвиг вёрстки, и выигрыш от плейсхолдера
      съедается подскоком контента.</li>
  <li><b>Ничего не считается на рендере.</b> Плейсхолдер вычисляется один раз при загрузке. Если он
      считается на запрос страницы, вы поменяли 10 мс один раз на 10 мс каждому посетителю.</li>
  <li><b>Очередь не должна блокировать выдачу.</b> Пока производные не готовы, отдаём оригинал.
      Страница, которая ждёт воркера, хуже страницы, которая отдала файл потяжелее.</li>
</ul>
</div>

<h2>Выводы</h2>
<ul>
  <li><b>По умолчанию — base64 LQIP в WebP на 12–20 px</b> (${fmt(main.base64.sizes[1].bytes)}–${fmt(main.base64.primary.bytes)} на эту картинку).
      Ноль JS, рисуется первым пейнтом, из инструментов нужен только sharp при загрузке файла.
      Берите его не потому, что он легче всех, а потому что он самый дешёвый в эксплуатации.</li>
  <li><b>В весе разметки base64 LQIP и хэши идут вровень</b> — после честного пересжатия декода в WebP
      разница в пределах нескольких десятков байт. Выбор между ними решается не байтами,
      а тем, нужен ли вам компактный вид для БД, API и мобильного клиента.</li>
  <li><b>Нужен настоящий минимум в разметке — «одно число»</b> (${fmt(main.lqipInt.bytes)}, в ${Math.round(main.base64.primary.bytes / main.lqipInt.bytes)}× легче base64).
      Декодер CSS подключается один раз на всё приложение, дальше каждая картинка стоит несколько символов.
      Цена — грубая сетка 3×2 и современные браузеры (<code>mod()</code>, <code>round()</code>, <code>oklab()</code>).</li>
  <li><b>Не берите CSS-градиенты и SVG ради экономии</b>: ${fmt(main.gradient.bytes)} и ${fmt(main.svg.bytes)} —
      это тяжелее base64 LQIP в ${Math.round(main.gradient.bytes / main.base64.primary.bytes)}–${Math.round(main.svg.bytes / main.base64.primary.bytes)} раза
      при худшей детализации. У них своя ниша: не нужен растровый кодек и нужен плавный масштаб.</li>
  <li>Плейсхолдер считается <b>один раз при загрузке файла</b> и хранится рядом с ним — колонкой в БД
      или в метаданных объекта. Не на каждый запрос.</li>
  <li>На длинных списках следите за бюджетом HTML: сто карточек по ${fmt(main.base64.primary.bytes)}
      это ${fmt(main.base64.primary.bytes * 100)} в документе. Первому экрану — base64, остальным — «одно число» или цвет.</li>
  <li>LCP-картинку <b>не</b> помечайте <code>loading="lazy"</code> — ей <code>fetchpriority="high"</code>.
      И <code>width</code>/<code>height</code> обязательны везде, иначе сдвиг вёрстки съест весь выигрыш.</li>
</ul>

<h2>Источники</h2>
<ul class="dim">
  <li><a href="https://www.mux.com/blog/blurry-image-placeholders-on-the-web">Mux — A clear look at blurry image placeholders on the web</a></li>
  <li><a href="https://leanrada.com/notes/css-only-lqip/">Lean Rada — Minimal CSS-only blurry image placeholders</a></li>
  <li><a href="https://evanw.github.io/thumbhash/">ThumbHash</a> · <a href="https://blurha.sh/">BlurHash</a></li>
  <li><a href="https://plaiceholder.co/docs">plaiceholder</a> · <a href="https://github.com/transitive-bullshit/lqip-modern">lqip-modern</a> · <a href="https://unlazy.byjohann.dev/">unlazy</a></li>
</ul>

</div>
<script>
(function () {
  var body = document.body;
  var timer;

  /** Задержка выбранного пресета — уже посчитана из веса файла на сборке страницы. */
  function currentDelay() {
    var checked = document.querySelector('input[name="speed"]:checked');
    return checked ? Number(checked.dataset.delay) : 600;
  }

  function replay() {
    clearTimeout(timer);
    body.dataset.state = 'idle';
    // Снимаем src, чтобы браузер заново показал плейсхолдер под картинкой.
    document.querySelectorAll('img.real').forEach(function (img) {
      img.removeAttribute('src');
    });

    timer = setTimeout(function () {
      document.querySelectorAll('img.real').forEach(function (img) {
        img.src = img.dataset.src;
      });
      body.dataset.state = 'loaded';
    }, currentDelay());
  }

  document.getElementById('replay').addEventListener('click', replay);
  document.querySelectorAll('input[name="speed"]').forEach(function (radio) {
    radio.addEventListener('change', replay);
  });
  replay();
})();
</script>
<script>
(function () {
${clientScript()}
})();
</script>
</body>
</html>
`;
}
