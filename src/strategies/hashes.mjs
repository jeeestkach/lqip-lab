/**
 * Вариант 4 — компактные хэши: ThumbHash и BlurHash.
 * Настоящие библиотеки, не порт по памяти, поэтому байты честные.
 *
 * Важно: сами по себе хэши — это НЕ пиксели. Чтобы плейсхолдер появился,
 * их надо декодировать. Здесь мы декодируем на сервере (как делает unlazy при SSR),
 * и тогда в разметку всё равно уезжает data URI — то есть выигрыш в байтах,
 * ради которого хэш и брали, на вебе теряется. Ради этого сравнения всё и считаем.
 */

import sharp from 'sharp';
import { rgbaToThumbHash, thumbHashToDataURL, thumbHashToRGBA } from 'thumbhash';
import { encode as blurhashEncode, decode as blurhashDecode } from 'blurhash';

/**
 * Пересжимает RGBA-пиксели в WebP data URI.
 *
 * Нужно для честного сравнения: библиотеки хэшей отдают декод в PNG (без потерь),
 * а base64 LQIP — это WebP с потерями. Сравнивать их напрямую значит сравнивать
 * кодеки, а не техники, поэтому считаем оба числа.
 *
 * @param rgba Буфер RGBA-пикселей.
 * @param width Ширина в пикселях.
 * @param height Высота в пикселях.
 * @returns data URI в формате WebP.
 */
async function rgbaToWebpDataUri(rgba, width, height) {
  const webp = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

/**
 * Готовит RGBA-пиксели уменьшенной копии.
 * @param input Буфер исходного изображения.
 * @param max Максимальная сторона уменьшенной копии.
 * @returns `{ data, width, height }`, где data — RGBA-байты.
 */
async function toRgba(input, max) {
  const { data, info } = await sharp(input)
    .resize(max, max, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Кодирует ThumbHash и сразу декодирует его в data URI (серверный SSR-путь).
 * @param input Буфер исходного изображения.
 * @returns Хэш в base64, его вес, и вес получившегося data URI.
 */
export async function buildThumbHash(input) {
  // Ограничение формата: сторона не больше 100 px.
  const { data, width, height } = await toRgba(input, 100);
  const hash = rgbaToThumbHash(width, height, data);
  const hashBase64 = Buffer.from(hash).toString('base64');
  const dataUri = thumbHashToDataURL(hash);

  // То же изображение, но пересжатое в WebP — сопоставимо с base64 LQIP по кодеку.
  const rgba = thumbHashToRGBA(hash);
  const webpUri = await rgbaToWebpDataUri(rgba.rgba, rgba.w, rgba.h);

  return {
    hashBase64,
    hashBytes: hash.length,
    markupBytes: Buffer.byteLength(hashBase64, 'utf8'),
    dataUri,
    decodedBytes: Buffer.byteLength(dataUri, 'utf8'),
    webpUri,
    webpBytes: Buffer.byteLength(webpUri, 'utf8'),
  };
}

/**
 * Кодирует BlurHash и декодирует его в PNG data URI (серверный SSR-путь).
 * @param input Буфер исходного изображения.
 * @param componentX Число компонент по горизонтали, 1..9.
 * @param componentY Число компонент по вертикали, 1..9.
 */
export async function buildBlurHash(input, componentX = 4, componentY = 4) {
  const { data, width, height } = await toRgba(input, 64);
  const hash = blurhashEncode(new Uint8ClampedArray(data), width, height, componentX, componentY);

  // Декод отдаёт голые RGBA-пиксели — собираем из них PNG через sharp.
  const outW = 32;
  const outH = Math.max(1, Math.round((height / width) * outW));
  const pixels = blurhashDecode(hash, outW, outH);
  const png = await sharp(Buffer.from(pixels), {
    raw: { width: outW, height: outH, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const dataUri = `data:image/png;base64,${png.toString('base64')}`;
  const webpUri = await rgbaToWebpDataUri(pixels, outW, outH);

  return {
    hash,
    markupBytes: Buffer.byteLength(hash, 'utf8'),
    components: `${componentX}×${componentY}`,
    dataUri,
    decodedBytes: Buffer.byteLength(dataUri, 'utf8'),
    webpUri,
    webpBytes: Buffer.byteLength(webpUri, 'utf8'),
  };
}
