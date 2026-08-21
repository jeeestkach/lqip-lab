/**
 * Сжатие ответов сервера.
 *
 * Nitro в пресете `node-server` не сжимает НИЧЕГО: подразумевается, что впереди
 * стоит nginx или CDN. Локально этого нет, и замеры искажаются — причём не только
 * по HTML. Ответы API тоже текстовые и жмутся втрое: 15,1 КБ → 4,5 КБ.
 *
 * Статику Nitro жмёт на сборке (`compressPublicAssets`), здесь — динамика.
 */

import { useCompression } from 'h3-compression';

/** Типы, которые имеет смысл жать. Изображения уже сжаты своими кодеками. */
const COMPRESSIBLE = ['text/html', 'application/json', 'text/plain'];

/** Ниже этого порога заголовки сжатия стоят дороже выигрыша. */
const MIN_BYTES = 1024;

/** Стоит ли жать этот ответ. */
function shouldCompress(type: string, body: unknown): boolean {
  if (!COMPRESSIBLE.some((t) => type.includes(t))) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length >= MIN_BYTES;
}

export default defineNitroPlugin((nitro) => {
  // Страницы, отрисованные сервером.
  nitro.hooks.hook('render:response', async (response, { event }) => {
    const type = String(response.headers?.['content-type'] ?? '');
    if (!shouldCompress(type, response.body)) return;
    await useCompression(event, response);
  });

  // Ответы API идут мимо `render:response`, им нужен отдельный перехват.
  nitro.hooks.hook('beforeResponse', async (event, response) => {
    if (getResponseHeader(event, 'content-encoding')) return;
    const type = String(getResponseHeader(event, 'content-type') ?? '');
    if (!shouldCompress(type, response.body)) return;
    await useCompression(event, response as { body?: unknown; headers?: Record<string, string> });
  });
});
