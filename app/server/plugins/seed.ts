/**
 * Засев демонстрационного набора при старте.
 *
 * Без него развёрнутый экземпляр открывается пустым: хранилище живёт в томе,
 * а тома при первом развёртывании нет. Класть заготовленный том в образ нельзя —
 * он затирался бы при каждом обновлении.
 *
 * Набор — настоящая выдача каталога provybor.com: изображения в ОРИГИНАЛЬНОМ
 * размере (медиана 1200 px, а не 400 px как у `_md` на витрине) плюс товарные
 * данные из `catalog/products.json`, чтобы карточка в демке повторяла живую.
 *
 * Идемпотентно и пофайлово: дедупликация по sha256, повторный запуск дублей
 * не создаёт, а новые примеры подхватываются без стирания тома.
 *
 * Работает в фоне и НЕ задерживает готовность сервера.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Каталог с примерами внутри образа. */
const SAMPLES_DIR = process.env.LQIP_SAMPLES_DIR ?? '/app/samples';

/**
 * Размеры копий.
 *
 * Оригиналы теперь около 1200 px, поэтому 900 имеет смысл: на экране с двойной
 * плотностью карточка шириной 300 px требует 600 реальных пикселей, а страница
 * товара — заметно больше.
 */
const SIZES = [300, 600, 900];

/** Одна запись товарного каталога. */
interface CatalogEntry {
  slug: string;
  href: string;
  alt: string;
  title: string;
  supplier: string;
  supplierLogo?: string | null;
  supplierBadge?: string | null;
  price: string;
  minQty?: string;
}

/** Собирает изображения из каталога и вложенных папок. */
async function collectImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // logos/ — вспомогательные картинки поставщиков, отдельными товарами не идут.
    if (entry.isDirectory() && entry.name !== 'logos') out.push(...(await collectImages(full)));
    else if (entry.isFile() && /\.(jpe?g|png|webp|avif)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Читает товарные данные, если они рядом с изображениями. */
async function loadCatalog(): Promise<Map<string, CatalogEntry>> {
  const map = new Map<string, CatalogEntry>();
  try {
    const raw = await readFile(path.join(SAMPLES_DIR, 'catalog', 'products.json'), 'utf8');
    for (const item of JSON.parse(raw) as CatalogEntry[]) map.set(item.slug, item);
  } catch {
    // Данных нет — засеем одни изображения, без карточек товара.
  }
  return map;
}

export default defineNitroPlugin(() => {
  void (async () => {
    try {
      const repo = useRepo();
      const catalog = await loadCatalog();

      let files: string[];
      try {
        files = await collectImages(SAMPLES_DIR);
      } catch {
        console.log(`[seed] каталог примеров ${SAMPLES_DIR} недоступен — засев пропущен`);
        return;
      }
      if (!files.length) return console.log('[seed] примеров не найдено');

      const storage = useObjectStorage();
      let added = 0;

      for (const file of files) {
        const input = await readFile(file);
        const hash = sha256(input);
        if (await repo.findBySha(hash)) continue;

        const slug = path.basename(file).replace(/\.[^.]+$/, '');
        /*
         * Сопоставление с запасным вариантом по префиксу.
         *
         * Имена файлов обрезаны при скачивании, а слаги в каталоге бывают
         * длиннее — точное совпадение теряло такие товары, и они засевались
         * без карточки: ни поставщика, ни цены, ни ссылки. Семь из сорока.
         */
        const entry =
          catalog.get(slug) ?? [...catalog.values()].find((e) => e.slug.startsWith(slug));

        const processed = await processImage(input, SIZES);
        await storage.put(processed.originalKey, input, processed.originalMime);
        await Promise.all(processed.variants.map((v) => storage.put(v.key, v.body, 'image/webp')));

        await repo.insert({
          sha256: processed.sha256,
          originalKey: processed.originalKey,
          originalMime: processed.originalMime,
          originalBytes: processed.originalBytes,
          width: processed.width,
          height: processed.height,
          placeholders: processed.placeholders,
          placeholderFormat: processed.placeholderFormat,
          variants: processed.variants.map(({ body, ...v }) => v),
          title: entry?.title ?? entry?.alt ?? slug,
          ...(entry
            ? {
                product: {
                  href: entry.href,
                  supplier: entry.supplier,
                  ...(entry.supplierLogo ? { supplierLogo: entry.supplierLogo } : {}),
                  ...(entry.supplierBadge ? { supplierBadge: entry.supplierBadge } : {}),
                  price: entry.price,
                  ...(entry.minQty ? { minQty: entry.minQty } : {}),
                },
              }
            : {}),
          timings: processed.timings,
        });
        added += 1;
      }

      /*
       * Дозаполнение уже засеянных записей.
       *
       * Дедупликация по sha256 пропускает файл, который уже в хранилище, —
       * значит исправленное сопоставление на него бы не подействовало, и запись
       * навсегда осталась бы без поставщика и цены. Обновляем только товарные
       * поля: изображения и производные не трогаем.
       */
      let filled = 0;
      for (const rec of await repo.list()) {
        if (rec.product) continue;
        const entry =
          catalog.get(rec.title) ?? [...catalog.values()].find((e) => e.slug.startsWith(rec.title));
        if (!entry) continue;
        await repo.update(rec.id, {
          title: entry.title,
          product: {
            href: entry.href,
            supplier: entry.supplier,
            ...(entry.supplierLogo ? { supplierLogo: entry.supplierLogo } : {}),
            ...(entry.supplierBadge ? { supplierBadge: entry.supplierBadge } : {}),
            price: entry.price,
            ...(entry.minQty ? { minQty: entry.minQty } : {}),
          },
        });
        filled += 1;
      }

      console.log(`[seed] загружено: ${added}, дозаполнено: ${filled}`);
    } catch (err) {
      // Пустая демка неприятна, но падать из-за засева сервер не должен.
      console.error('[seed] не удалось засеять примеры:', (err as Error).message);
    }
  })();
});
