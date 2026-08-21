/**
 * Сжатие ответов SSR.
 *
 * Nitro в пресете node-server отдаёт HTML БЕЗ сжатия: подразумевается, что
 * впереди стоит nginx или CDN. Для локальных замеров это критично и искажает
 * сравнение — серверный рендер платит за свой документ полную цену, тогда как
 * в реальном развёртывании он приехал бы втрое меньше. Замер до правки:
 * 67 КБ без сжатия против 22,7 КБ в gzip.
 *
 * Статику Nitro жмёт отдельно (`compressPublicAssets`), здесь — только
 * динамические ответы.
 */

import { useCompression } from 'h3-compression';

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, { event }) => {
    // Жмём только текст: изображения уже сжаты своими кодеками, повторное
    // сжатие лишь тратит процессор и ничего не выигрывает.
    const type = String(response.headers?.['content-type'] ?? '');
    if (!type.includes('text/html')) return;
    await useCompression(event, response);
  });
});
