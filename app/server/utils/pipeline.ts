/**
 * Конвейер обработки изображения при загрузке.
 *
 * Порядок операций задан замерами (см. docs/ARCHITECTURE.md):
 *   плейсхолдер 20 px ≈ 10 мс, производная 1280 px WebP ≈ 231 мс, AVIF ≈ 2 с.
 * Поэтому плейсхолдер считается синхронно в запросе, а тяжёлые размеры — отдельно.
 *
 * Ключевое правило качества: ВИДИМЫЕ размеры режутся из оригинала, чтобы не
 * накапливать поколенческие потери. Исключение ровно одно и оно осознанное —
 * плейсхолдер 20 px делается из самой мелкой видимой копии: на двадцати пикселях
 * потери предыдущего сжатия физически неразличимы, а декодировать маленький
 * файл в разы дешевле, чем оригинал.
 */

import sharp from 'sharp';
import { createHash } from 'node:crypto';

/**
 * Ширины плейсхолдера, которые считаются при загрузке.
 *
 * Считаем СРАЗУ ВСЕ, а не одну: каждая стоит около двух миллисекунд и полкилобайта,
 * зато интерфейс переключает детальность мгновенно, без перезаливки файла.
 * Подобрать параметр на глазок иначе невозможно — а именно это и нужно.
 */
export const PLACEHOLDER_WIDTHS = [12, 20, 32, 50] as const;

/**
 * Ширина по умолчанию.
 *
 * Двенадцать, а не двадцать. Разницу съедает размытие: карточка в сетке — около
 * 223 px, поверх лежит `blur(10px)`, и после него 12 px от 20 px практически
 * неотличимы. Замер ошибки цвета в Oklab: 0,0290 против 0,0194 — обе величины
 * далеко за порогом различимости на размытом пятне.
 *
 * Платим за это заметно меньше: блок превью в сжатом документе 4 453 B вместо
 * 7 720 B, то есть документ витрины худеет с 19 867 до 16 232 B — на 18 %.
 * Все ширины по-прежнему считаются при загрузке, и страница сравнения может
 * запросить любую через `?ph=`.
 */
export const DEFAULT_PLACEHOLDER_WIDTH = 12;

/** Качество WebP для плейсхолдера. */
const PLACEHOLDER_QUALITY = 40;

/** Качество WebP для видимых размеров. */
const VARIANT_QUALITY = 75;

/** Размеры по умолчанию, если клиент не передал свои. */
export const DEFAULT_SIZES = [300, 640, 1280];

/**
 * Ширина копии под карточку каталога.
 *
 * Слот в сетке — около 200 CSS-пикселей, на экране с двойной плотностью это
 * 400 настоящих. Ровно столько и берём: меньше — мыло на ретине, больше —
 * трафик, который никто не увидит. Единственная ширина, поэтому `srcset`
 * карточке не нужен.
 */
export const CARD_WIDTH = 400;

/** Одна готовая производная. */
export interface Variant {
  width: number;
  height: number;
  format: 'webp';
  bytes: number;
  /** Ключ в объектном хранилище. */
  key: string;
  /** Содержимое — вызывающий код сам решает, когда его класть в хранилище. */
  body: Buffer;
}

/** Результат обработки одного файла. */
export interface Processed {
  sha256: string;
  width: number;
  height: number;
  originalBytes: number;
  originalKey: string;
  originalMime: string;
  /** base64 БЕЗ префикса `data:`, по одному на каждую ширину из PLACEHOLDER_WIDTHS. */
  placeholders: Record<string, string>;
  /** Формат плейсхолдеров; нужен, чтобы собрать правильный префикс. */
  placeholderFormat: 'webp';
  variants: Variant[];
  /** Тайминги по шагам, миллисекунды — их показывает демка. */
  timings: Record<string, number>;
}

/** Считает sha256 содержимого — он же ключ дедупликации. */
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Проверяет, что файл действительно изображение поддерживаемого типа.
 * Опирается на разбор самого файла, а не на расширение или заявленный MIME:
 * и то и другое приходит от клиента и ничего не гарантирует.
 * @param buf Содержимое файла.
 * @returns Метаданные sharp.
 * @throws Error Если формат не распознан или не поддерживается.
 */
async function probe(buf: Buffer) {
  const meta = await sharp(buf).metadata();
  const allowed = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'];
  if (!meta.format || !allowed.includes(meta.format)) {
    throw new Error(`неподдерживаемый формат: ${meta.format ?? 'не распознан'}`);
  }
  if (!meta.width || !meta.height) {
    throw new Error('не удалось определить размеры изображения');
  }
  return meta;
}

/**
 * Прогоняет изображение через весь конвейер.
 * @param input Содержимое загруженного файла.
 * @param sizes Запрошенные ширины видимых копий. Ширины больше оригинала отбрасываются.
 * @returns Всё, что нужно записать в хранилище и в БД.
 */
export async function processImage(input: Buffer, sizes: number[] = DEFAULT_SIZES): Promise<Processed> {
  const timings: Record<string, number> = {};
  const clock = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const out = await fn();
    timings[name] = Math.round((performance.now() - t0) * 10) / 10;
    return out;
  };

  const meta = await clock('probe', () => probe(input));
  const hash = sha256(input);

  // Апскейл запрещён: он раздувает вес и не добавляет ни пикселя информации.
  // Но запрос «шире оригинала» ПРИЖИМАЕМ к оригиналу, а не отбрасываем: иначе
  // на снимке 1200 px запрос 300/640/1280 дал бы только две копии, и самой
  // крупной ступени не осталось бы вовсе.
  const targets = [...new Set(
    sizes
      .filter((w) => w > 0)
      .map((w) => Math.min(w, meta.width!)),
  )].sort((a, b) => a - b);
  if (targets.length === 0) targets.push(Math.min(meta.width!, DEFAULT_SIZES[0]!));

  // Видимые размеры — каждый из ОРИГИНАЛА.
  const variants = await clock('variants', async () =>
    Promise.all(
      targets.map(async (width): Promise<Variant> => {
        const { data, info } = await sharp(input)
          .rotate() // применяем EXIF-ориентацию к пикселям, пока метаданные ещё есть
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: VARIANT_QUALITY })
          .toBuffer({ resolveWithObject: true });

        return {
          width: info.width,
          height: info.height,
          format: 'webp',
          bytes: data.length,
          key: `${hash}/${info.width}.webp`,
          body: data,
        };
      }),
    ),
  );

  // Плейсхолдеры — из самой мелкой видимой копии, а не из оригинала.
  const smallest = variants[0]!;
  const placeholders = await clock('placeholders', async () => {
    const entries = await Promise.all(
      PLACEHOLDER_WIDTHS.map(async (w) => {
        const buf = await sharp(smallest.body)
          .resize({ width: Math.min(w, smallest.width) })
          .webp({ quality: PLACEHOLDER_QUALITY })
          .toBuffer();
        return [String(w), buf.toString('base64')] as const;
      }),
    );
    return Object.fromEntries(entries);
  });

  return {
    sha256: hash,
    width: meta.width!,
    height: meta.height!,
    originalBytes: input.length,
    originalKey: `${hash}/original.${meta.format}`,
    originalMime: `image/${meta.format}`,
    placeholders,
    placeholderFormat: 'webp',
    variants,
    timings,
  };
}

/**
 * Собирает data URI из хранимого base64.
 * Префикс не хранится в БД — он одинаков для всех записей одного формата,
 * и держать его в каждой строке значит платить 23 байта на запись ни за что.
 * @param base64 Полезная нагрузка без префикса.
 * @param format Формат плейсхолдера.
 */
export function toDataUri(base64: string, format: string): string {
  return `data:image/${format};base64,${base64}`;
}
