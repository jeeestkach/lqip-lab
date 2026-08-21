/**
 * GET /cdn/** — отдача объектов из хранилища.
 *
 * Играет роль CDN для локальной демки. Заголовки кеширования выставлены как
 * у настоящего CDN: содержимое адресуется хешем, поэтому ключ никогда не меняет
 * содержимое, и `immutable` здесь честен, а не оптимистичен.
 *
 * Опциональный `?delay=<мс>` притормаживает ответ — им демка показывает
 * ступени загрузки на медленном соединении, не трогая троттлинг DevTools.
 */

export default defineEventHandler(async (event) => {
  const segments = getRouterParam(event, 'path');
  if (!segments) throw createError({ statusCode: 400, statusMessage: 'не указан путь' });

  const storage = useObjectStorage();

  let body: Buffer;
  try {
    body = await storage.get(segments);
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'объект не найден' });
  }

  const delay = Number.parseInt(String(getQuery(event).delay ?? ''), 10);
  const throttled = Number.isFinite(delay) && delay > 0;
  if (throttled) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
  }

  const ext = segments.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    avif: 'image/avif',
    gif: 'image/gif',
  };

  setResponseHeader(event, 'content-type', types[ext] ?? 'application/octet-stream');

  // Обычный ответ кешируется навсегда: ключ объекта это хеш содержимого,
  // поэтому под одним URL никогда не окажется других байтов, и `immutable` честен.
  //
  // Но замедленный ответ кешировать НЕЛЬЗЯ: `?delay=` входит в ключ кеша, и после
  // первого запроса браузер отдавал бы «медленный» URL мгновенно из кеша —
  // демонстрация ступеней сломалась бы после первого же показа.
  setResponseHeader(
    event,
    'cache-control',
    throttled ? 'no-store' : 'public, max-age=31536000, immutable',
  );
  setResponseHeader(event, 'content-length', body.length);
  return body;
});
