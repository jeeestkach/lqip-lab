/**
 * GET /api/images?ph=20 — каталог: все записи, новые первыми.
 *
 * `ph` задаёт единственную нужную ширину плейсхолдера. `ph=all` вернёт все —
 * это нужно только странице загрузки, где ширины сравнивают между собой.
 */

import { toPublic } from './index.post';

export default defineEventHandler(async (event) => {
  const storage = useObjectStorage();
  const ph = String(getQuery(event).ph ?? '');
  const records = await useRepo().list();
  return { count: records.length, images: records.map((r) => toPublic(r, storage, ph)) };
});
