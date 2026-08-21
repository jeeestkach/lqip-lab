/**
 * GET /api/images/:id — запись об изображении: ссылки на все размеры
 * плюс готовый плейсхолдер с префиксом.
 */

import { toPublic } from './index.post';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, statusMessage: 'не указан id' });

  const record = await useRepo().findById(id);
  if (!record) throw createError({ statusCode: 404, statusMessage: 'изображение не найдено' });

  return toPublic(record, useObjectStorage(), String(getQuery(event).ph ?? ''));
});
