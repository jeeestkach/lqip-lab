/**
 * GET /api/images — каталог: все записи, новые первыми.
 */

import { toPublic } from './index.post';

export default defineEventHandler(async () => {
  const storage = useObjectStorage();
  const records = await useRepo().list();
  return { count: records.length, images: records.map((r) => toPublic(r, storage)) };
});
