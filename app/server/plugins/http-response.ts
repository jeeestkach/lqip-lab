/**
 * Заголовки ответа для отрисованных страниц: версия документа, кеш, сжатие.
 *
 * Nitro в пресете `node-server` не делает ничего из этого: подразумевается, что
 * впереди стоит nginx или CDN. Здесь их нет, и замеры искажаются.
 *
 * ── Что здесь на самом деле стоило дорого ───────────────────────────────────
 * Ответ страницы каталога занимал около 250 мс, и это списывали на «серверный
 * рендер сорока карточек». Замер показал другое: рендер стоит ~6 мс, а 180 мс
 * съедало СЖАТИЕ. `h3-compression` вызывает brotli с качеством по умолчанию —
 * одиннадцатым, максимальным, — и делал это заново на каждый запрос:
 *
 *   accept-encoding: br        медиана 248 мс
 *   accept-encoding: gzip      медиана  67 мс
 *   accept-encoding: identity  медиана  62 мс
 *
 * Отсюда два решения ниже: качество brotli опущено до разумного (см. константу)
 * и результат сжатия запоминается по версии документа — одинаковый HTML жмётся
 * ОДИН раз, а не заново на каждый запрос.
 *
 * ── Зачем версия документа ──────────────────────────────────────────────────
 * Страница каталога меняется только при засеве, а отдавалась заново на каждый
 * запрос: без `etag` и `cache-control` браузеру нечем понять, что его копия
 * ещё годится. Теперь `etag` есть; браузер присылает его в `if-none-match`,
 * и если ничего не изменилось, ответом идёт 304 без тела. Плюс `max-age` —
 * внутри этого окна браузер не спрашивает вовсе.
 */

import { createHash } from 'node:crypto';
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Типы, которые имеет смысл жать. Изображения уже сжаты своими кодеками. */
const COMPRESSIBLE = ['text/html', 'application/json', 'text/plain'];

/** Ниже этого порога заголовки сжатия стоят дороже выигрыша. */
const MIN_BYTES = 1024;

/**
 * Сколько секунд документ считается свежим без переспроса.
 *
 * Каталог меняется только засевом, так что минута безопасна: дольше держать
 * незачем, а короче — значит переспрашивать на каждый переход по страницам.
 */
const HTML_MAX_AGE = 60;

/**
 * Сколько секунд разрешено показывать протухшую копию, обновляя её фоном.
 *
 * Посетитель получает страницу мгновенно, а свежую версию браузер подтянет
 * к следующему разу. Для витрины это приемлемо: устареть она может максимум
 * на один засев.
 */
const HTML_SWR = 300;

/**
 * Качество brotli для документа.
 *
 * Десятое. Сначала стояло восьмое — чтобы не платить за сжатие на каждом
 * запросе. Потом ниже появилось запоминание сжатого по версии документа,
 * и это соображение устарело: теперь дорогое сжатие платится ОДИН РАЗ
 * на версию, а экономия достаётся каждому посетителю.
 *
 * Замер на нынешнем документе (69 797 B), медиана из пяти прогонов:
 *
 *   кач.  4 — 17 052 B,  0,6 мс
 *   кач.  8 — 15 932 B,  1,2 мс   ← было
 *   кач.  9 — 15 876 B,  1,3 мс
 *   кач. 10 — 14 454 B, 25,2 мс   ← взято
 *   кач. 11 — 14 457 B, 69,3 мс
 *
 * Одиннадцатое не берём: оно на три байта ХУЖЕ десятого и втрое дороже —
 * его окно и словарь на таком размере уже не окупаются.
 *
 * Двадцать пять миллисекунд платит первый посетитель новой версии. Прогрев
 * при старте забирает эту цену на себя, так что не платит и он.
 */
const BROTLI_QUALITY = 10;

/**
 * Запомненные сжатые представления, ключ — версия документа плюс кодировка.
 *
 * Одинаковый HTML жмётся один раз, а не на каждый запрос. Проверено: два
 * последовательных рендера страницы каталога дают побайтово одинаковый
 * результат, поэтому версия документа — надёжный ключ.
 *
 * Оговорка: это память процесса, и она не переживает перезапуск. Для витрины
 * с полутора сотнями товаров этого достаточно; ограничение по числу записей
 * ниже удерживает её от бесконтрольного роста.
 */
const compressed = new Map<string, Buffer>();

/** Потолок хранилища сжатых копий: страниц у демки немного. */
const COMPRESSED_LIMIT = 64;

/** Стоит ли жать этот ответ. */
function shouldCompress(type: string, body: unknown): boolean {
  if (!COMPRESSIBLE.some((t) => type.includes(t))) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length >= MIN_BYTES;
}

/** Какую кодировку просит клиент. `null` — отдаём как есть. */
function negotiate(accept: string | undefined): 'br' | 'gzip' | null {
  if (!accept) return null;
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

/**
 * Сжимает тело, переиспользуя результат для той же версии документа.
 *
 * @param body Готовый HTML.
 * @param encoding Согласованная кодировка.
 * @param key Версия документа — тот же ETag, что уедет клиенту.
 */
async function compress(body: string, encoding: 'br' | 'gzip', key: string): Promise<Buffer> {
  const cacheKey = `${key}:${encoding}`;
  const hit = compressed.get(cacheKey);
  if (hit) return hit;

  const raw = Buffer.from(body, 'utf8');
  const out =
    encoding === 'br'
      ? await brotli(raw, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            // Подсказка о размере даёт кодеку выбрать окно по факту, а не по максимуму.
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        })
      : await gz(raw);

  // Вытесняем по одной самой старой записи: разных страниц у демки единицы,
  // и до потолка дело доходит только при частом засеве.
  if (compressed.size >= COMPRESSED_LIMIT) {
    const oldest = compressed.keys().next().value;
    if (oldest) compressed.delete(oldest);
  }
  compressed.set(cacheKey, out);
  return out;
}

/**
 * Версия документа по его содержимому.
 *
 * Пометка `W/` (слабая) — намеренно: одна и та же страница отдаётся то сжатой,
 * то нет, и это разные байты при одном и том же смысле. Сильный ETag обязывал бы
 * выдавать разные версии на каждое представление.
 *
 * @param body Готовый HTML.
 * @returns Значение заголовка `etag` вместе с кавычками.
 */
function etagOf(body: string): string {
  return `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;
}

/**
 * Прислал ли клиент ту же версию, что у нас на руках.
 *
 * `if-none-match` допускает список через запятую и звёздочку; браузеры шлют
 * одно значение, промежуточные кеши — бывает, что несколько.
 */
function matchesEtag(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => candidate.trim() === tag);
}

/** Микросекунды между двумя отсчётами. */
function usSince(from: bigint): number {
  return Number(process.hrtime.bigint() - from) / 1000;
}

export default defineNitroPlugin((nitro) => {
  /*
   * Отметка начала обработки.
   *
   * Нужна, чтобы отделить время отрисовки от времени сжатия: снаружи они
   * сливаются в одно «сервер думал», и именно из-за этого слипания brotli
   * максимального качества полгода выдавался за медленный рендер.
   */
  nitro.hooks.hook('request', (event) => {
    event.context.t0 = process.hrtime.bigint();
  });

  // Страницы, отрисованные сервером.
  nitro.hooks.hook('render:response', async (response, { event }) => {
    const body = typeof response.body === 'string' ? response.body : null;
    const t0 = event.context.t0 as bigint | undefined;
    /** Отрисовка: от начала обработки до готовой строки HTML. */
    const renderUs = t0 ? usSince(t0) : 0;

    if (body) {
      const tEtag = process.hrtime.bigint();
      const tag = etagOf(body);
      const etagUs = usSince(tEtag);
      event.context.timing = { renderUs, etagUs, bytes: body.length };
      response.headers = response.headers ?? {};
      response.headers.etag = tag;
      response.headers['cache-control'] =
        `public, max-age=${HTML_MAX_AGE}, stale-while-revalidate=${HTML_SWR}`;
      // Ответ бывает сжатым и несжатым. Без этого промежуточный кеш способен
      // отдать gzip тому, кто его не просил.
      response.headers.vary = 'accept-encoding';

      if (matchesEtag(getRequestHeader(event, 'if-none-match'), tag)) {
        /*
         * Копия клиента годится: тело не отправляем, сжимать нечего.
         *
         * Отрисовка при этом УЖЕ случилась — страница собрана целиком только
         * ради того, чтобы посчитать её версию и выбросить. Так устроен любой
         * ETag поверх динамической страницы; сэкономить эти миллисекунды можно
         * лишь запомнив версию по адресу, но тогда придётся самостоятельно
         * решать, когда она устарела.
         */
        response.statusCode = 304;
        response.statusMessage = 'Not Modified';
        response.body = '';
        response.headers['server-timing'] = timingHeader({ renderUs, etagUs });
        return;
      }
    }

    const type = String(response.headers?.['content-type'] ?? '');
    if (!body || !shouldCompress(type, body)) return;

    const encoding = negotiate(getRequestHeader(event, 'accept-encoding'));
    if (!encoding) return;

    const tag = String(response.headers.etag);
    const cached = compressed.has(`${tag}:${encoding}`);
    const tCompress = process.hrtime.bigint();
    const out = await compress(body, encoding, tag);
    const compressUs = usSince(tCompress);

    response.body = out;
    response.headers['content-encoding'] = encoding;
    response.headers['content-length'] = String(out.length);

    const t = event.context.timing as { renderUs: number; etagUs: number } | undefined;
    response.headers['server-timing'] = timingHeader({
      renderUs: t?.renderUs ?? 0,
      etagUs: t?.etagUs ?? 0,
      compressUs,
      compressCached: cached,
    });

    /*
     * Готовую страницу — в кеш, чтобы следующий такой же запрос не доходил
     * до отрисовки. Кладём ПОСЛЕ сжатия: там уже есть и разметка, и версия,
     * и сжатое представление, то есть всё, что нужно для ответа.
     */
    const key = pageCacheKey(event.path.split('?')[0]!, getQuery(event));
    if (key) {
      const existing = getPage(key);
      // Представления накапливаются: brotli и gzip приходят разными запросами.
      const encoded = existing?.etag === tag ? existing.encoded : new Map<string, Buffer>();
      encoded.set(encoding, out);
      setPage(key, { html: body, etag: tag, encoded });
    }
  });
});

/**
 * Собирает заголовок `server-timing` — разбор ответа по этапам.
 *
 * Виден во вкладке «Сеть» любого браузера рядом с самим запросом, поэтому
 * не требует ни отдельной страницы, ни логов. Именно такая разбивка показала,
 * что 180 мс уходили не на отрисовку, а на сжатие.
 *
 * Подписи латиницей: заголовки HTTP переносят только однобайтные знаки, и
 * кириллица роняет ответ с `ERR_INVALID_CHAR`. Это ограничение протокола,
 * а не предпочтение.
 */
function timingHeader(t: {
  renderUs: number;
  etagUs: number;
  compressUs?: number;
  compressCached?: boolean;
}): string {
  const ms = (us: number) => (us / 1000).toFixed(2);
  const parts = [
    `render;desc="SSR";dur=${ms(t.renderUs)}`,
    `etag;desc="version";dur=${ms(t.etagUs)}`,
  ];
  if (t.compressUs !== undefined) {
    parts.push(`br;desc="${t.compressCached ? 'brotli-cached' : 'brotli'}";dur=${ms(t.compressUs)}`);
  }
  return parts.join(', ');
}
