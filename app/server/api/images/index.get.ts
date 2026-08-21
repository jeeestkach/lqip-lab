/**
 * GET /api/images?ph=20 — каталог: все записи, новые первыми.
 *
 * Ответ намеренно компактный: без `srcset` (собирается из `variants`),
 * без оригинала, таймингов и даты. Всё это нужно странице загрузки, а каталогу
 * только мешает — замер показал 2,4 КБ дублирования и 2,6 КБ неиспользуемых
 * полей из 15,1 КБ. Полную запись отдаёт `/api/images/:id`.
 *
 * `ph` задаёт единственную нужную ширину плейсхолдера; `ph=all` вернёт все.
 */

import { toPublic } from './index.post';

export default defineEventHandler(async (event) => {
  const storage = useObjectStorage();
  const q = getQuery(event);
  const ph = String(q.ph ?? '');
  const full = q.full === '1' || ph === 'all';

  const records = await useRepo().list();
  const images = records.map((r) => toPublic(r, storage, ph, full));

  // Каталог меняется только при загрузке новых файлов. Короткого кеша
  // достаточно, чтобы повторный рендер страницы не пересобирал ответ.
  setResponseHeader(event, 'cache-control', 'public, max-age=30');

  return sendJson(event, { count: records.length, images });
});
