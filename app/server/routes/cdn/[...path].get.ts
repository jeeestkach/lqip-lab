/**
 * GET /cdn/** — отдача объектов из хранилища.
 *
 * Играет роль CDN для локальной демки. Содержимое адресуется хешем, поэтому под
 * одним ключом никогда не окажется других байтов — `immutable` здесь честен.
 *
 * `?speed=<профиль>` притормаживает ответ ровно на столько, сколько файл ехал бы
 * по такому каналу: задержка сети плюс размер, делённый на полосу. Это НЕ то же,
 * что фиксированная пауза: тяжёлый файл ждёт дольше лёгкого, и картинки приходят
 * неровно — как в жизни. Пропускная способность считается на файл, а не на весь
 * канал; порядком и параллельностью управляет клиент.
 */

import { findSpeed, transferMs } from '../../../shared/speeds';

/** MIME по расширению ключа. */
const TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
  gif: 'image/gif',
};

export default defineEventHandler(async (event) => {
  const segments = getRouterParam(event, 'path');
  if (!segments) throw createError({ statusCode: 400, statusMessage: 'не указан путь' });

  const storage = useObjectStorage();

  /*
   * Выбор формата по заголовку `accept`.
   *
   * Адрес у копии один и оканчивается на `.webp` — он же стоит в разметке.
   * Браузер, понимающий AVIF, получает рядом лежащий `.avif`: он на четверть
   * легче при той же или лучшей точности (замер — см. AVIF_QUALITY в конвейере).
   * Остальные получают WebP по тому же адресу.
   *
   * Так разметка не растёт на `<picture>` с двумя источниками, а адрес остаётся
   * один — значит и запись в кеше одна. Плата — заголовок `vary: accept`,
   * без которого промежуточный кеш отдал бы AVIF тому, кто его не понимает.
   */
  let key = segments;
  let negotiated = false;
  if (segments.endsWith('.webp') && String(getRequestHeader(event, 'accept') ?? '').includes('image/avif')) {
    const alt = `${segments.slice(0, -'.webp'.length)}.avif`;
    if (await storage.exists(alt)) { key = alt; negotiated = true; }
  }

  let body: Buffer;
  try {
    body = await storage.get(key);
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'объект не найден' });
  }

  const speed = findSpeed(String(getQuery(event).speed ?? ''));
  const wait = transferMs(body.length, speed);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60_000)));
  }

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  setResponseHeader(event, 'content-type', TYPES[ext] ?? 'application/octet-stream');
  // Один адрес — два возможных ответа. Без этого промежуточный кеш способен
  // отдать AVIF браузеру, который его не понимает.
  if (negotiated || segments.endsWith('.webp')) setResponseHeader(event, 'vary', 'accept');

  // Замедленный ответ кешировать НЕЛЬЗЯ: `?speed=` входит в ключ кеша, и после
  // первого запроса браузер отдавал бы «медленный» URL мгновенно из кеша —
  // повторный прогон демонстрации сломался бы.
  setResponseHeader(
    event,
    'cache-control',
    wait > 0 ? 'no-store' : 'public, max-age=31536000, immutable',
  );
  setResponseHeader(event, 'content-length', body.length);
  // Чтобы клиент мог показать, сколько реально приехало байт.
  setResponseHeader(event, 'x-transfer-ms', String(wait));

  return body;
});
