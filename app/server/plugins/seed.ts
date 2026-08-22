/**
 * Засев демонстрационного набора при старте.
 *
 * Без него развёрнутая демка открывается пустой: хранилище живёт в томе,
 * а тома при первом развёртывании нет. Класть заготовленный том в образ нельзя —
 * он бы затирался при каждом обновлении.
 *
 * Идемпотентно: если в репозитории уже есть записи, ничего не делается.
 * Сама обработка тоже дедуплицирует по sha256, так что повторный запуск
 * не создаст дублей даже при гонке.
 *
 * Запускается в фоне и НЕ задерживает готовность сервера: обработка полутора
 * десятков файлов занимает секунды, а healthcheck ждать их не должен.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Каталог с примерами внутри образа. */
const SAMPLES_DIR = process.env.LQIP_SAMPLES_DIR ?? '/app/samples';

/** Размеры копий для демонстрационного набора. */
const SIZES = [300, 640];

/**
 * Собирает изображения из каталога и ВЛОЖЕННЫХ папок.
 *
 * Плоский обход пропускал товарные снимки: они лежат подпапкой, а именно
 * на них построено сравнение стратегий. Засевалось пять посторонних картинок
 * вместо девятнадцати нужных.
 *
 * @param dir Каталог для обхода.
 * @returns Полные пути найденных изображений, по возрастанию.
 */
async function collectImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectImages(full)));
    else if (/\.(jpe?g|png|webp|avif)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', () => undefined); // no-op: плагин работает при старте

  void (async () => {
    try {
      const repo = useRepo();

      /*
       * Проверяем ПОФАЙЛОВО, а не «есть ли вообще записи».
       *
       * Прежний вариант пропускал засев целиком при любой непустой базе,
       * поэтому добавленные позже примеры не подхватывались никогда — только
       * стиранием тома, а том трогать нельзя. Дедупликация идёт по sha256,
       * так что повторный проход дешёв и безопасен.
       */
      let files: string[];
      try {
        files = await collectImages(SAMPLES_DIR);
      } catch {
        console.log(`[seed] каталог примеров ${SAMPLES_DIR} недоступен — засев пропущен`);
        return;
      }

      if (!files.length) {
        console.log('[seed] примеров не найдено');
        return;
      }

      const storage = useObjectStorage();
      let added = 0;

      for (const file of files) {
        const input = await readFile(file);
        const hash = sha256(input);
        if (await repo.findBySha(hash)) continue;

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
          title: path.basename(file).replace(/\.[^.]+$/, ''),
          timings: processed.timings,
        });
        added += 1;
      }

      console.log(`[seed] загружено примеров: ${added}`);
    } catch (err) {
      // Пустая демка неприятна, но падать из-за засева сервер не должен.
      console.error('[seed] не удалось засеять примеры:', (err as Error).message);
    }
  })();
});
