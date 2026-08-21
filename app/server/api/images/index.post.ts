/**
 * POST /api/images — загрузка изображения в высоком качестве.
 *
 * Тело: multipart/form-data, поле `file` (можно несколько), опционально `title`.
 * Query: `sizes=300,640,1280` — кастомные ширины видимых копий.
 *
 * Всё, что здесь происходит, происходит СИНХРОННО: по замерам полный конвейер
 * укладывается в сотни миллисекунд, и запись сразу пригодна к рендеру.
 * Разделение на очередь понадобится, когда добавится AVIF (≈2 с на копию).
 */

import { processImage, DEFAULT_SIZES, DEFAULT_PLACEHOLDER_WIDTH, toDataUri } from '../../utils/pipeline';
import type { ImageRecord } from '../../utils/db';

/** Разбирает `sizes=300,640` в массив ширин. */
function parseSizes(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_SIZES;
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 8192);
  return parsed.length ? parsed : DEFAULT_SIZES;
}

/**
 * Форма записи, которую видит клиент: ключи заменены на публичные URL.
 *
 * @param phWidth Если задана — отдаём ТОЛЬКО эту ширину плейсхолдера.
 *   Все четыре нужны лишь странице загрузки, где их сравнивают. Обычному
 *   потребителю лишние ширины — мёртвый груз: замер показал, что они занимали
 *   23 КБ из 39 КБ payload гидратации, три четверти впустую.
 */
export function toPublic(
  record: ImageRecord,
  storage: { url(key: string): string },
  phWidth?: string,
  full = true,
) {
  const sorted = [...record.variants].sort((a, b) => a.width - b.width);
  const chosen = phWidth && record.placeholders[phWidth] ? phWidth : String(DEFAULT_PLACEHOLDER_WIDTH);
  return {
    id: record.id,
    title: record.title,
    width: record.width,
    height: record.height,
    // Готовый data URI с префиксом — клиенту не надо ничего доклеивать.
    placeholder: toDataUri(
      record.placeholders[chosen] ?? Object.values(record.placeholders)[0]!,
      record.placeholderFormat,
    ),
    // Все ширины — только по явному запросу: их сравнивают на странице загрузки.
    ...(phWidth === 'all'
      ? {
          placeholders: Object.fromEntries(
            Object.entries(record.placeholders).map(([w, b64]) => [w, toDataUri(b64, record.placeholderFormat)]),
          ),
        }
      : {}),
    variants: sorted.map((v) => ({
      width: v.width,
      height: v.height,
      bytes: v.bytes,
      url: storage.url(v.key),
    })),

    /*
     * Всё, что ниже, в список каталога НЕ уезжает.
     *
     * `srcset` — чистое дублирование: он целиком собирается из `variants`,
     *   а весил 2,4 КБ из 15,1 КБ ответа. Пусть его собирает клиент.
     * `original` — каталогу не нужен: там показывается копия 300 px.
     * `timings` — отладочные данные, место которым на странице загрузки.
     * `format` у вариантов — всегда webp, повторять его в каждом объекте незачем.
     */
    ...(full
      ? {
          original: { url: storage.url(record.originalKey), bytes: record.originalBytes },
          srcset: sorted.map((v) => `${storage.url(v.key)} ${v.width}w`).join(', '),
          timings: record.timings,
          createdAt: record.createdAt,
        }
      : {}),
  };
}

export default defineEventHandler(async (event) => {
  const storage = useObjectStorage();
  const repo = useRepo();

  const sizes = parseSizes(getQuery(event).sizes);
  const parts = await readMultipartFormData(event);
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'ожидается multipart/form-data с полем file' });
  }

  const titleField = parts.find((p) => p.name === 'title');
  const defaultTitle = titleField?.data.toString('utf8').trim();
  const files = parts.filter((p) => p.name === 'file' && p.filename);
  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: 'не найдено ни одного поля file' });
  }

  const results = [];
  for (const file of files) {
    const hash = sha256(file.data);

    // Дедупликация по содержимому: повторная загрузка того же файла не
    // создаёт новую запись и не запускает обработку заново.
    const existing = await repo.findBySha(hash);
    if (existing) {
      results.push({ ...toPublic(existing, storage), deduplicated: true });
      continue;
    }

    let processed;
    try {
      processed = await processImage(file.data, sizes);
    } catch (err) {
      throw createError({
        statusCode: 415,
        statusMessage: `${file.filename}: ${(err as Error).message}`,
      });
    }

    // Сначала объекты, потом запись: если упадём между шагами, в хранилище
    // останется мусор, но в БД не будет записи со ссылкой в никуда.
    await storage.put(processed.originalKey, file.data, processed.originalMime);
    await Promise.all(
      processed.variants.map((v) => storage.put(v.key, v.body, 'image/webp')),
    );

    const record = await repo.insert({
      sha256: processed.sha256,
      originalKey: processed.originalKey,
      originalMime: processed.originalMime,
      originalBytes: processed.originalBytes,
      width: processed.width,
      height: processed.height,
      placeholders: processed.placeholders,
      placeholderFormat: processed.placeholderFormat,
      variants: processed.variants.map(({ body, ...v }) => v),
      title: defaultTitle || (file.filename ?? 'Без названия').replace(/\.[^.]+$/, ''),
      timings: processed.timings,
    });

    results.push({ ...toPublic(record, storage), deduplicated: false });
  }

  setResponseStatus(event, 201);
  return { count: results.length, images: results };
});
