/**
 * Отдача JSON со сжатием и запоминанием готового ответа.
 *
 * Nitro в пресете `node-server` не сжимает ничего: подразумевается nginx или CDN
 * впереди. Для HTML это чинится хуком `render:response`, но ответы API идут мимо
 * него — h3-compression рассчитан на рендер страниц. Поэтому здесь явно и просто.
 *
 * ── Почему сжатое запоминается ──────────────────────────────────────────────
 * Замер на сервере разложил стоимость ответа каталога: brotli 2,41 мс (81 %),
 * сборка 0,53 мс, чтения с диска на горячем пути нет. Под нагрузкой эти четыре
 * миллисекунды превращаются в пятьдесят: Nitro однопоточный, и синхронное
 * сжатие блокирует цикл событий вместе с отрисовкой страниц.
 */

import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createHash as sha } from 'node:crypto';
import type { H3Event } from 'h3';
import type { CachedResponse } from './apiCache';

/** Ниже этого порога заголовки сжатия стоят дороже выигрыша. */
const MIN_BYTES = 1024;

/**
 * Качество brotli для ответов API.
 *
 * Пятое, а не выше. В отличие от документа, ответ собирается под конкретную
 * порцию и вариантов у него больше, а выигрыш от старших качеств здесь мелкий:
 * замер на теле 23 928 B — q5 даёт 10 726 B за 1,52 мс, q8 — 10 616 B за 2,07,
 * то есть сто байт за треть лишнего времени.
 */
const BROTLI_QUALITY = 5;

/** Какую кодировку просит клиент. `null` — отдаём как есть. */
function negotiate(accept: string | undefined): 'br' | 'gzip' | null {
  if (!accept) return null;
  // Brotli плотнее gzip примерно на пятую часть, поэтому предпочитаем его.
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

/** Проставляет заголовки представления и возвращает тело. */
function deliver(event: H3Event, resp: CachedResponse): Buffer | string | null {
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');
  setResponseHeader(event, 'etag', resp.etag);
  // Сжатие зависит от заголовка запроса — без Vary промежуточные кеши
  // отдали бы сжатый ответ клиенту, который его не принимает.
  setResponseHeader(event, 'vary', 'accept-encoding');

  if (getRequestHeader(event, 'if-none-match') === resp.etag) {
    setResponseStatus(event, 304);
    return null;
  }

  const encoding = negotiate(getRequestHeader(event, 'accept-encoding'));
  const packed = encoding ? resp.encoded.get(encoding) : undefined;
  if (!packed) return resp.body;

  setResponseHeader(event, 'content-encoding', encoding!);
  setResponseHeader(event, 'content-length', packed.length);
  return packed;
}

/**
 * Отдаёт заранее собранный ответ.
 *
 * Тело при этом не строится вовсе — вместе с ним не строится и его версия.
 * Раньше версия считалась по уже собранному телу, то есть ответ собирали
 * целиком ради того, чтобы выяснить, что он не нужен.
 */
export function sendCached(event: H3Event, resp: CachedResponse): Buffer | string | null {
  return deliver(event, resp);
}

export interface SendJsonOptions {
  /** Куда положить готовый ответ, чтобы в следующий раз не собирать заново. */
  cache?: (value: CachedResponse) => void;
}

/**
 * Сериализует данные в JSON и отдаёт со сжатием, если клиент его принимает.
 * @param event Событие запроса.
 * @param data Тело ответа.
 * @param opts Куда запомнить готовый ответ.
 * @returns Буфер, готовый к отправке.
 */
export function sendJson(event: H3Event, data: unknown, opts: SendJsonOptions = {}): Buffer | string | null {
  const body = JSON.stringify(data);

  /*
   * Версию считаем по НЕСЖАТОМУ телу: сжатие зависит от заголовков запроса,
   * и метка, посчитанная по сжатому, различалась бы у клиентов с разной
   * поддержкой кодировок при одинаковом содержимом.
   */
  const etag = `W/"${sha('sha1').update(body).digest('base64url').slice(0, 22)}"`;

  const encoded = new Map<string, Buffer>();
  if (body.length >= MIN_BYTES) {
    const raw = Buffer.from(body, 'utf8');
    /*
     * Готовим ОБА представления сразу, а не только запрошенное.
     *
     * Ответ кладётся в память один раз и потом достаётся любому клиенту:
     * если приготовить лишь brotli, следующий клиент с gzip заставил бы
     * собирать всё заново. Второе сжатие стоит доли миллисекунды и платится
     * однажды.
     */
    encoded.set('br', brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }));
    encoded.set('gzip', gzipSync(raw, { level: 6 }));
  }

  const resp: CachedResponse = { body, etag, encoded };
  opts.cache?.(resp);
  return deliver(event, resp);
}
