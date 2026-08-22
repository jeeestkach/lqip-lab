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
 * Качество brotli для страниц, собираемых на лету.
 *
 * Замер на нашем документе (89 885 B), медиана из семи прогонов:
 *
 *   кач. 11 — 18 227 B, 149,0 мс   ← значение по умолчанию, и оно разорительно
 *   кач.  8 — 19 921 B,   1,8 мс   ← взято
 *   кач.  5 — 20 377 B,   1,4 мс
 *   кач.  4 — 21 156 B,   0,9 мс
 *   gzip 6  — 25 711 B
 *
 * Восьмое отдаёт девять процентов размера и выигрывает восемьдесят раз по
 * времени. Одиннадцатое придумано для файлов, которые жмут один раз при сборке
 * и потом раздают годами; для страницы, собираемой на лету, оно бессмысленно.
 */
const BROTLI_QUALITY = 8;

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

export default defineNitroPlugin((nitro) => {
  // Страницы, отрисованные сервером.
  nitro.hooks.hook('render:response', async (response, { event }) => {
    const body = typeof response.body === 'string' ? response.body : null;

    if (body) {
      const tag = etagOf(body);
      response.headers = response.headers ?? {};
      response.headers.etag = tag;
      response.headers['cache-control'] =
        `public, max-age=${HTML_MAX_AGE}, stale-while-revalidate=${HTML_SWR}`;
      // Ответ бывает сжатым и несжатым. Без этого промежуточный кеш способен
      // отдать gzip тому, кто его не просил.
      response.headers.vary = 'accept-encoding';

      if (matchesEtag(getRequestHeader(event, 'if-none-match'), tag)) {
        // Копия клиента годится: тело не отправляем, сжимать нечего.
        response.statusCode = 304;
        response.statusMessage = 'Not Modified';
        response.body = '';
        return;
      }
    }

    const type = String(response.headers?.['content-type'] ?? '');
    if (!body || !shouldCompress(type, body)) return;

    const encoding = negotiate(getRequestHeader(event, 'accept-encoding'));
    if (!encoding) return;

    const out = await compress(body, encoding, String(response.headers.etag));
    response.body = out;
    response.headers['content-encoding'] = encoding;
    response.headers['content-length'] = String(out.length);
  });
});
