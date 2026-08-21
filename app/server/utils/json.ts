/**
 * Отдача JSON со сжатием.
 *
 * Nitro в пресете `node-server` не сжимает ничего: подразумевается nginx или CDN
 * впереди. Для HTML это чинится хуком `render:response`, но ответы API идут мимо
 * него — h3-compression рассчитан на рендер страниц. Поэтому здесь явно и просто.
 *
 * Замер: каталог из 14 записей — 15,1 КБ без сжатия против 4,5 КБ в gzip.
 * Семьдесят процентов лежали неиспользованными.
 */

import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createHash as sha } from 'node:crypto';
import type { H3Event } from 'h3';

/** Ниже этого порога заголовки сжатия стоят дороже выигрыша. */
const MIN_BYTES = 1024;

/**
 * Сериализует данные в JSON и отдаёт со сжатием, если клиент его принимает.
 * @param event Событие запроса.
 * @param data Тело ответа.
 * @returns Буфер, готовый к отправке.
 */
export function sendJson(event: H3Event, data: unknown): Buffer | string | null {
  const body = JSON.stringify(data);
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');

  /*
   * ETag считаем по НЕСЖАТОМУ телу: сжатие зависит от заголовков запроса,
   * и метка, посчитанная по сжатому, различалась бы у клиентов с разной
   * поддержкой кодировок при одинаковом содержимом.
   *
   * Если у клиента уже есть эта версия — отвечаем 304 и НЕ отправляем тело
   * вовсе. Для повторного захода это дешевле любого сжатия: ноль байт.
   */
  const etag = `W/"${sha('sha1').update(body).digest('base64url').slice(0, 22)}"`;
  setResponseHeader(event, 'etag', etag);

  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304);
    return null;
  }

  if (body.length < MIN_BYTES) return body;

  const accepted = String(getRequestHeader(event, 'accept-encoding') ?? '');
  // Brotli плотнее gzip примерно на пятую часть, поэтому предпочитаем его.
  const encoding = accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : null;
  if (!encoding) return body;

  const raw = Buffer.from(body, 'utf8');
  const packed =
    encoding === 'br'
      ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
      : gzipSync(raw, { level: 6 });

  setResponseHeader(event, 'content-encoding', encoding);
  setResponseHeader(event, 'content-length', packed.length);
  // Сжатие зависит от заголовка запроса — без Vary промежуточные кеши
  // отдали бы сжатый ответ клиенту, который его не принимает.
  setResponseHeader(event, 'vary', 'accept-encoding');
  return packed;
}
