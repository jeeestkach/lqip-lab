/**
 * Интерактивная демка: пользователь бросает свои изображения на страницу,
 * браузер прямо здесь считает лучший вариант плейсхолдера и показывает результат.
 *
 * Исполняется ТОЛЬКО в браузере. Модуль инлайнится в страницу вместе с
 * `oklab.mjs` и `lqip-format.mjs` — то есть арифметика ровно та же, что на сервере,
 * и цифры в демке сходятся с цифрами в статических блоках выше.
 *
 * Доступные из инлайна символы: rgbToOklab, oklabToRgb, toHex, packLqip, unpackBaseLab.
 */

/** Ширина уменьшенной копии для base64 LQIP. Компромисс вес/узнаваемость. */
const LQIP_WIDTH = 20;

/** Качество WebP для плейсхолдера. */
const LQIP_QUALITY = 0.4;

/** Вес строки в байтах — считаем так же, как на сервере. */
const byteLen = (s) => new Blob([s]).size;

/** Форматирует байты. */
const fmtBytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);

/** Во сколько раз меньше оригинала. */
function timesLess(bytes, total) {
  const t = total / bytes;
  const n =
    t >= 1000 ? Math.round(t / 100) * 100
    : t >= 100 ? Math.round(t / 10) * 10
    : t >= 10 ? Math.round(t)
    : Number(t.toFixed(1));
  return `в ${n.toLocaleString('ru-RU').replace(/ /g, ' ')}× меньше`;
}

/** Ширина промежуточной копии, с которой снимаются все выборки. */
const MID_WIDTH = 96;

/**
 * Декодирует файл ОДИН раз и отдаёт промежуточную уменьшенную копию.
 *
 * Один декод на файл — принципиально: каждый вызов `createImageBitmap(file)`
 * заново разжимает весь исходник, и три вызова ради трёх выборок давали
 * по три четверти секунды на снимок. Промежуток в 96 px достаточно мелкий,
 * чтобы дальнейшие уменьшения были дешёвыми, и достаточно крупный, чтобы
 * усреднение до 20 px и 3×2 оставалось осмысленным.
 *
 * @param file Исходный File.
 * @returns `{ canvas, data, width, height }` промежуточной копии.
 */
async function toMid(file) {
  const bitmap = await createImageBitmap(file);
  const w = Math.min(MID_WIDTH, bitmap.width);
  const h = Math.max(1, Math.round((w * bitmap.height) / bitmap.width));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return { canvas, data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

/**
 * Уменьшает промежуточную копию до нужного размера.
 * @param mid Результат toMid().
 * @param w Ширина результата.
 * @param h Высота результата.
 * @returns `{ canvas, data }`, где data — RGBA-массив.
 */
function shrink(mid, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid.canvas, 0, 0, w, h);
  return { canvas, data: ctx.getImageData(0, 0, w, h).data };
}

/** Средний цвет по всем пикселям RGBA-массива. */
function averageRgb(data) {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * Считает все варианты плейсхолдера для одного изображения.
 * @param file Исходный File.
 * @param img Загруженный HTMLImageElement — только ради размеров и превью.
 * @returns Объект с data URI, числом «одного числа», доминирующим цветом и таймингами.
 */
async function encode(file, img) {
  const t0 = performance.now();
  const originalBytes = file.size;

  const ratio = img.naturalHeight / img.naturalWidth;
  const lqipH = Math.max(1, Math.round(LQIP_WIDTH * ratio));

  const mid = await toMid(file);
  const small = shrink(mid, LQIP_WIDTH, lqipH);
  const grid = shrink(mid, 3, 2);

  // 1. base64 LQIP — рекомендованный вариант.
  let dataUri = small.canvas.toDataURL('image/webp', LQIP_QUALITY);
  // Safari до 16 не умеет кодировать WebP и молча отдаёт PNG — тогда берём JPEG.
  const isWebp = dataUri.startsWith('data:image/webp');
  if (!isWebp) dataUri = small.canvas.toDataURL('image/jpeg', 0.35);

  // 2. Доминирующий цвет: усреднение по всей промежуточной копии точнее,
  // чем уменьшение до 1×1 средствами drawImage.
  const avg = averageRgb(mid.data);
  const hex = toHex(avg.r, avg.g, avg.b);

  // 3. «Одно число» — сетка 3×2 плюс средний цвет.
  const cellLs = [];
  for (let i = 0; i < 6; i += 1) {
    const o = i * 4;
    cellLs.push(rgbToOklab(grid.data[o], grid.data[o + 1], grid.data[o + 2]).L);
  }
  const packed = packLqip(rgbToOklab(avg.r, avg.g, avg.b), cellLs);
  const lab = unpackBaseLab(packed.ll, packed.aaa, packed.bbb);
  const fallback = oklabToRgb(lab.L, lab.a, lab.b);

  const ms = performance.now() - t0;

  return {
    dataUri,
    format: isWebp ? 'WebP' : 'JPEG',
    lqipBytes: byteLen(dataUri),
    hex,
    hexBytes: byteLen(hex),
    lqipInt: packed.value,
    lqipIntBytes: byteLen(String(packed.value)),
    lqipIntFallback: toHex(fallback.r, fallback.g, fallback.b),
    width: img.naturalWidth,
    height: img.naturalHeight,
    originalBytes,
    ms,
  };
}

/** Живые object URL текущей пачки — освобождаются при следующей загрузке. */
let liveUrls = [];

/** Освобождает object URL предыдущей пачки. */
function releaseUrls() {
  liveUrls.forEach(URL.revokeObjectURL);
  liveUrls = [];
}

/**
 * Загружает File в HTMLImageElement.
 *
 * Object URL НЕ освобождается сразу после onload: он же используется как превью
 * оригинала в выдаче. Освобождение перенесено на начало следующей пачки.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    liveUrls.push(url);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось прочитать файл'));
    img.src = url;
  });
}

/** Экранирует текст для вставки в HTML. */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Рисует результат для одного файла. */
function renderResult(file, r, objectUrl) {
  const snippet = `<img src="${esc(file.name)}" width="${r.width}" height="${r.height}"
     style="background-image:url('${r.dataUri.slice(0, 40)}…');background-size:cover">`;

  return `<div class="up-item">
  <div class="up-name">${esc(file.name)} <span class="dim">${r.width}×${r.height} · ${fmtBytes(r.originalBytes)}</span></div>
  <div class="up-grid">
    <figure class="mini">
      <div class="frame" style="aspect-ratio:${r.width} / ${r.height}">
        <div class="ph" style="background-image:url('${objectUrl}');background-size:cover"></div>
      </div>
      <figcaption><b>оригинал</b><span class="bytes">${fmtBytes(r.originalBytes)}</span></figcaption>
      <div class="card-pct dim">для сверки</div>
    </figure>
    <figure class="mini mini-best">
      <div class="frame" style="aspect-ratio:${r.width} / ${r.height}">
        <div class="ph blur" style="background-image:url('${r.dataUri}');background-size:cover"></div>
      </div>
      <figcaption><b>base64 LQIP</b><span class="bytes">${fmtBytes(r.lqipBytes)}</span></figcaption>
      <div class="card-pct">${timesLess(r.lqipBytes, r.originalBytes)}</div>
    </figure>
    <figure class="mini">
      <div class="frame" style="aspect-ratio:${r.width} / ${r.height}">
        <div class="ph ph-lqip-int" style="--lqip:${r.lqipInt};--lqip-fallback:${r.lqipIntFallback}"></div>
      </div>
      <figcaption><b>одно число</b><span class="bytes">${fmtBytes(r.lqipIntBytes)}</span></figcaption>
      <div class="card-pct">${timesLess(r.lqipIntBytes, r.originalBytes)}</div>
    </figure>
    <figure class="mini">
      <div class="frame" style="aspect-ratio:${r.width} / ${r.height}">
        <div class="ph" style="background-color:${r.hex}"></div>
      </div>
      <figcaption><b>цвет</b><span class="bytes">${fmtBytes(r.hexBytes)}</span></figcaption>
      <div class="card-pct">${timesLess(r.hexBytes, r.originalBytes)}</div>
    </figure>
  </div>
  <div class="up-meta">
    <span class="up-stat">обработано за <b>${r.ms.toFixed(0)} мс</b></span>
    <span class="up-stat">формат <b>${r.format}</b></span>
    <span class="up-stat">число: <code>${r.lqipInt}</code></span>
    <span class="up-stat">цвет: <code>${r.hex}</code></span>
  </div>
  <pre><code>${esc(snippet)}</code></pre>
</div>`;
}

/** Подключает дропзону и обработку файлов. */
function initUploader() {
  const zone = document.getElementById('dropzone');
  const input = document.getElementById('fileinput');
  const out = document.getElementById('upresults');
  const summary = document.getElementById('upsummary');
  if (!zone || !input || !out) return;

  async function handle(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;

    releaseUrls();
    out.innerHTML = '<p class="dim">считаю…</p>';
    const started = performance.now();
    const html = [];
    let totalIn = 0;
    let totalOut = 0;
    let encodeMs = 0;

    for (const file of list) {
      try {
        const img = await loadImage(file);
        const r = await encode(file, img);
        totalIn += r.originalBytes;
        totalOut += r.lqipBytes;
        encodeMs += r.ms;
        html.push(renderResult(file, r, img.src));
      } catch (err) {
        html.push(`<div class="up-item"><b>${esc(file.name)}</b> — ${esc(err.message)}</div>`);
      }
    }

    out.innerHTML = html.join('\n');

    const wall = performance.now() - started;
    summary.hidden = false;
    summary.innerHTML =
      `<b>${list.length}</b> ${list.length === 1 ? 'изображение' : 'изображений'} · ` +
      `<b>${fmtBytes(totalIn)}</b> → <b>${fmtBytes(totalOut)}</b> плейсхолдеров · ` +
      `<b>${timesLess(totalOut, totalIn)}</b> · ` +
      `счёт <b>${encodeMs.toFixed(0)} мс</b>, всего с чтением файлов <b>${wall.toFixed(0)} мс</b>`;
  }

  input.addEventListener('change', () => handle(input.files));
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag');
    handle(e.dataTransfer.files);
  });
}

initUploader();
