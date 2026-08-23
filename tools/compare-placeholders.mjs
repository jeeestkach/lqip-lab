/**
 * Сравнение способов показать превью — один прогон, одна мера.
 *
 * Запуск из корня репозитория: node tools/compare-placeholders.mjs
 * Берёт живой документ витрины из /tmp/live.html (положить туда заранее:
 *   curl -sH "accept-encoding: identity" https://lqip.nikita-morozov.ru/demo/ssr -o /tmp/live.html)
 * и подставляет в него блок превью каждого способа.
 *
 * ── Две вещи, без которых сравнение врёт ────────────────────────────────────
 *
 * 1. Размер меряется как РАЗНИЦА размера всего документа в brotli, а не как
 *    размер блока. base64 почти не сжимается, а текст градиента сжимается
 *    в разы — по сырому размеру они несравнимы вовсе.
 *
 * 2. Качество меряется ПОСЛЕ размытия — того самого blur(10px), что лежит
 *    в карточке. Иначе мозаика из плиток проигрывает за блочность, которой
 *    в готовом виде не видно: размытие для того там и стоит.
 *
 * Маска насыщенности при этом снимается с РЕЗКОГО оригинала: после размытия
 * ярких мест почти не остаётся, и мера, снятая по размытому, вырождается
 * в ноль. Это отдельная колонка — та самая, где пропадают красные детали.
 */
import sharp from 'sharp';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const W = 40, H = 53;
/** Карточка 223 px против рабочих 40 — масштаб 5,6; blur(10px) даёт сигму 1,8. */
const SIGMA = 1.8;

const doc = fs.readFileSync('/tmp/live.html', 'utf8');
const br = (s) => zlib.brotliCompressSync(Buffer.from(s, 'utf8'),
  { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 8, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: s.length } }).length;
const cur = doc.match(/<style>(\.ph-[^<]*)<\/style>/)[1];
const ids = [...cur.matchAll(/\.ph-([\w-]+)\{/g)].map((m) => m[1]);
const dir = 'input/catalog/images';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).sort().slice(0, ids.length);

const blurRaw = async (buf, w = W, h = H) => {
  const b = await sharp(buf).resize(w, h, { fit: 'fill' }).blur(SIGMA).removeAlpha().raw().toBuffer();
  return Float64Array.from(b);
};
const h1 = (v) => Math.round(v / 17).toString(16);

function oklab(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  r = f(r); g = f(g); b = f(b);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
/**
 * Средняя ошибка и отдельно — ошибка ТАМ, ГДЕ В ОРИГИНАЛЕ ЯРКИЙ ЦВЕТ.
 *
 * Маска насыщенности снимается с НЕразмытого оригинала: после размытия ярких
 * мест почти не остаётся, и мера, снятая по размытому, вырождается в ноль —
 * ровно эту ошибку я и допустил в первом прогоне. Сравнение при этом идёт
 * по размытым кадрам: именно их видно в карточке.
 */
function err(t, p, mask) {
  let sum = 0, vs = 0, vn = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [l1,a1,b1] = oklab(t[i], t[i+1], t[i+2]);
    const [l2,a2,b2] = oklab(p[i], p[i+1], p[i+2]);
    const d = Math.hypot(l1-l2, a1-a2, b1-b2);
    sum += d;
    if (mask[i/3]) { vs += d; vn++; }
  }
  return { all: sum / (t.length/3), vivid: vn ? vs/vn : 0 };
}
/** Разница размера документа с этим блоком и без него. */
function docDelta(block) {
  const sw = doc.replace(cur, block);
  return br(sw) - br(sw.replace(block, ''));
}

const targets = [], masks = [];
for (const f of files) {
  targets.push(await blurRaw(path.join(dir, f)));
  // маска — по резкому оригиналу, до размытия
  const sharpRaw = await sharp(path.join(dir, f)).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const mx = Math.max(sharpRaw[i*3], sharpRaw[i*3+1], sharpRaw[i*3+2]);
    const mn = Math.min(sharpRaw[i*3], sharpRaw[i*3+1], sharpRaw[i*3+2]);
    m[i] = mx - mn >= 60 ? 1 : 0;
  }
  masks.push(m);
}

const rows = [];
async function add(name, build, note = '') {
  const rules = []; let e = 0, v = 0;
  for (let k = 0; k < files.length; k++) {
    const { rule, raster } = await build(path.join(dir, files[k]), ids[k]);
    rules.push(rule);
    const r = err(targets[k], raster, masks[k]);
    e += r.all; v += r.vivid;
  }
  const blk = rules.join('');
  rows.push({ name, raw: blk.length, doc: docDelta(blk), e: e/files.length, v: v/files.length, note });
}

// ── превью-картинка разных ширин и качеств
for (const [w, q] of [[12,40],[12,60],[16,25],[16,40],[20,25],[20,40],[32,40]]) {
  await add(`WebP ${w}px / q${q}`, async (file, id) => {
    const small = await sharp(file).resize(w).webp({ quality: q }).toBuffer();
    return { rule: `.ph-${id}{--ph:url(data:image/webp;base64,${small.toString('base64')})}`, raster: await blurRaw(small) };
  }, w === 12 && q === 40 ? 'нынешний' : '');
}

// ── мозаика: структура в общем правиле, на карточку только цвета
for (const [c, r] of [[3,4],[4,5],[5,7]]) {
  const img = [], size = [], pos = [];
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) {
    const i = y*c + x;
    img.push(`linear-gradient(var(--${i}),var(--${i}))`);
    size.push(`${(100/c).toFixed(2)}% ${(100/r).toFixed(2)}%`);
    pos.push(`${c===1?0:((x/(c-1))*100).toFixed(2)}% ${r===1?0:((y/(r-1))*100).toFixed(2)}%`);
  }
  const shared = `.ph{--ph:${img.join(',')};--s:${size.join(',')};--p:${pos.join(',')}}`;
  let first = true;
  await add(`мозаика ${c}x${r}`, async (file, id) => {
    const cells = await sharp(file).resize(c, r, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const vals = [];
    for (let i = 0; i < c*r; i++) vals.push(`--${i}:#${h1(cells[i*3])}${h1(cells[i*3+1])}${h1(cells[i*3+2])}`);
    // плитки без интерполяции: увеличиваем ближайшим соседом, затем то же размытие
    const tile = await sharp(Buffer.from(cells), { raw: { width: c, height: r, channels: 3 } })
      .resize(W, H, { kernel: 'nearest' }).png().toBuffer();
    const rule = (first ? shared : '') + `.ph-${id}{${vals.join(';')}}`;
    first = false;
    return { rule, raster: await blurRaw(tile) };
  }, 'структура в общем правиле');
}

// ── радиальные по решётке, структура повторяется на каждой карточке
{
  const c = 4, r = 5;
  await add(`радиальные ${c}x${r} без общего правила`, async (file, id) => {
    const cells = await sharp(file).resize(c, r, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const L = [];
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) {
      const i = y*c + x, col = `#${h1(cells[i*3])}${h1(cells[i*3+1])}${h1(cells[i*3+2])}`;
      L.push(`radial-gradient(${(100/c).toFixed(0)}% ${(100/r).toFixed(0)}% at ${(((x+.5)/c)*100).toFixed(0)}% ${(((y+.5)/r)*100).toFixed(0)}%,${col} 0,rgb(from ${col} r g b/0) 100%)`);
    }
    const tile = await sharp(Buffer.from(cells), { raw: { width: c, height: r, channels: 3 } })
      .resize(W, H, { kernel: 'nearest' }).png().toBuffer();
    return { rule: `.ph-${id}{--ph:${L.join(',')}}`, raster: await blurRaw(tile) };
  }, 'цена тиражирования синтаксиса');
}

// ── доминирующий цвет и полное отсутствие
await add('доминирующий цвет', async (file, id) => {
  const { dominant } = await sharp(file).stats();
  const px = Buffer.alloc(W*H*3);
  for (let i = 0; i < W*H; i++) { px[i*3] = dominant.r; px[i*3+1] = dominant.g; px[i*3+2] = dominant.b; }
  const img = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return { rule: `.ph-${id}{--ph:linear-gradient(#${h1(dominant.r)}${h1(dominant.g)}${h1(dominant.b)},#${h1(dominant.r)}${h1(dominant.g)}${h1(dominant.b)})}`, raster: await blurRaw(img) };
}, 'stats().dominant, не среднее');

await add('без превью', async (_file, id) => {
  const px = Buffer.alloc(W*H*3, 128);
  const img = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return { rule: '', raster: await blurRaw(img) };
}, 'серый фон рамки');

const cur12 = rows.find((r) => r.note === 'нынешний');
console.log('  способ                            сырых    в документе   против нынешнего   ошибка   на насыщенных');
for (const r of rows.sort((a, b) => a.doc - b.doc)) {
  const d = r.doc - cur12.doc;
  const sign = r === cur12 ? '  —' : `${d > 0 ? '+' : ''}${d}`;
  console.log(`  ${r.name.padEnd(32)} ${String(r.raw).padStart(6)} ${String(r.doc).padStart(9)} B ${sign.padStart(12)} B   ${r.e.toFixed(4)}   ${r.v.toFixed(4)}${r.note === 'нынешний' ? '  <- сейчас' : ''}`);
}
