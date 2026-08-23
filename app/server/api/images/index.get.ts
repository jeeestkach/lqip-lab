/**
 * GET /api/images — каталог порциями.
 *
 * Query:
 *   · `ph`               — ширина плейсхолдера; `all` вернёт все четыре;
 *   · `catalog=1`        — только записи с товарными данными;
 *   · `offset` / `limit` — окно выдачи;
 *   · `v`                — версия набора товаров; совпала — ответ `immutable`;
 *   · `full=1`           — полная запись со всеми копиями и таймингами.
 *
 * Ответ намеренно компактный: без `srcset`, оригинала, таймингов и даты — всё
 * это нужно странице загрузки, а каталогу только мешает. Полную запись отдаёт
 * `/api/images/:id`.
 *
 * Готовый ответ запоминается целиком, вместе со сжатыми представлениями:
 * пересобирать одно и то же незачем, а под нагрузкой синхронное сжатие
 * блокирует цикл событий вместе с отрисовкой страниц.
 */

import { toPublic } from './index.post';
import { catalogVersion, getResponse, setResponse } from '../../utils/apiCache';

/** Сколько записей отдаём, если размер порции не задан. */
const DEFAULT_LIMIT = 40;

/** Потолок на порцию: защита от `limit=100000` в адресе. */
const MAX_LIMIT = 200;

/** Год — столько живёт ответ, чей адрес несёт верную версию набора. */
const IMMUTABLE_MAX_AGE = 31_536_000;

/** Читает неотрицательное целое из query, иначе — значение по умолчанию. */
function intParam(raw: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const ph = String(q.ph ?? '');
  const full = q.full === '1' || ph === 'all';
  const onlyCatalog = q.catalog === '1';
  const offset = intParam(q.offset, 0, Number.MAX_SAFE_INTEGER);
  const limit = intParam(q.limit, DEFAULT_LIMIT, MAX_LIMIT);

  const version = catalogVersion();
  /*
   * Адрес с ВЕРНОЙ версией набора не протухает никогда: сменится набор —
   * сменится и адрес. Без версии живём одну минуту и переспрашиваем.
   */
  const versioned = String(q.v ?? '') === String(version);
  setResponseHeader(
    event,
    'cache-control',
    versioned ? `public, max-age=${IMMUTABLE_MAX_AGE}, immutable` : 'public, max-age=60',
  );

  const key = `${onlyCatalog ? 'c' : 'a'}:${ph}:${full ? 'f' : 's'}:${offset}:${limit}`;
  const hit = getResponse(key);
  if (hit) {
    // Тело собирать незачем: версия ответа лежит рядом с ним. Раньше её считали
    // по уже собранному телу, то есть весь ответ строился ради того, чтобы
    // выяснить, что он не нужен.
    return sendCached(event, hit);
  }

  const storage = useObjectStorage();
  let records = await useRepo().list();

  /*
   * Витрине — только товары.
   *
   * В хранилище лежат ещё и снимки, загруженные вручную через /upload: карточка
   * для них вышла бы без поставщика, цены и ссылки. Фильтровать надо ЗДЕСЬ,
   * а не на клиенте: иначе `total` считает лишнее, и постраничная выдача
   * обещает больше товаров, чем витрина в состоянии показать.
   */
  if (onlyCatalog) records = records.filter((r) => r.product?.href);

  const total = records.length;
  const page = records.slice(offset, offset + limit);
  const images = page.map((r) => toPublic(r, storage, ph, full));

  return sendJson(
    event,
    { count: images.length, total, offset, limit, version, images },
    { cache: (value) => setResponse(key, value) },
  );
});
