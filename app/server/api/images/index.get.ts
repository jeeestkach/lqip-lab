/**
 * GET /api/images — каталог порциями.
 *
 * Query:
 *   · `ph`               — ширина плейсхолдера; `all` вернёт все четыре;
 *   · `catalog=1`        — только записи с товарными данными;
 *   · `offset` / `limit` — окно выдачи;
 *   · `full=1`           — полная запись со всеми копиями и таймингами.
 *
 * Ответ намеренно компактный: без `srcset`, оригинала, таймингов и даты — всё
 * это нужно странице загрузки, а каталогу только мешает. Полную запись отдаёт
 * `/api/images/:id`.
 */

import { toPublic } from './index.post';

/** Сколько записей отдаём, если размер порции не задан. */
const DEFAULT_LIMIT = 40;

/** Потолок на порцию: защита от `limit=100000` в адресе. */
const MAX_LIMIT = 200;

/** Читает неотрицательное целое из query, иначе — значение по умолчанию. */
function intParam(raw: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export default defineEventHandler(async (event) => {
  const storage = useObjectStorage();
  const q = getQuery(event);
  const ph = String(q.ph ?? '');
  const full = q.full === '1' || ph === 'all';

  let records = await useRepo().list();

  /*
   * Витрине — только товары.
   *
   * В хранилище лежат ещё и снимки, загруженные вручную через /upload: карточка
   * для них вышла бы без поставщика, цены и ссылки. Фильтровать надо ЗДЕСЬ,
   * а не на клиенте: иначе `total` считает лишнее, и постраничная выдача
   * обещает больше товаров, чем витрина в состоянии показать.
   */
  if (q.catalog === '1') records = records.filter((r) => r.product?.href);

  const total = records.length;
  const offset = intParam(q.offset, 0, Number.MAX_SAFE_INTEGER);
  const limit = intParam(q.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const page = records.slice(offset, offset + limit);

  const images = page.map((r) => toPublic(r, storage, ph, full));

  // Каталог меняется только при загрузке новых файлов. Короткого кеша
  // достаточно, чтобы повторный рендер страницы не пересобирал ответ.
  setResponseHeader(event, 'cache-control', 'public, max-age=30');

  return sendJson(event, { count: images.length, total, offset, limit, images });
});
