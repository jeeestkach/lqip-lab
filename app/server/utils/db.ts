/**
 * Хранилище записей об изображениях.
 *
 * Для локальной демки это JSON-файл: ноль зависимостей, содержимое можно
 * открыть глазами. Интерфейс `ImageRepo` намеренно узкий, чтобы замена на
 * PostgreSQL свелась к одной реализации, без правок в API и рендере.
 *
 * Схему таблицы для настоящей БД см. docs/ARCHITECTURE.md §3.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Производная в том виде, в каком она хранится. */
export interface StoredVariant {
  width: number;
  height: number;
  format: string;
  bytes: number;
  key: string;
}

/** Запись об изображении. */
export interface ImageRecord {
  id: string;
  sha256: string;
  /** Ключ оригинала в объектном хранилище. */
  originalKey: string;
  originalMime: string;
  originalBytes: number;
  width: number;
  height: number;
  /** base64 плейсхолдеров БЕЗ префикса `data:`, ключ — ширина в пикселях. */
  placeholders: Record<string, string>;
  /** Формат плейсхолдеров — нужен, чтобы собрать префикс при рендере. */
  placeholderFormat: string;
  variants: StoredVariant[];
  /** Подпись товара — демка показывает карточки, а не голые файлы. */
  title: string;
  /**
   * Карточка товара целиком.
   *
   * Демка воспроизводит настоящую выдачу каталога, поэтому вместе с
   * изображением хранится всё, что показывает карточка: поставщик, цена,
   * минимальная партия, адрес страницы. Поле необязательно — снимки,
   * загруженные вручную через /upload, товаром не сопровождаются.
   */
  product?: {
    /** Адрес страницы товара — по нему делается предзагрузка при наведении. */
    href: string;
    supplier: string;
    /** Логотип поставщика; если его нет, показывается буквенный значок. */
    supplierLogo?: string;
    supplierBadge?: string;
    price: string;
    /** Минимальная партия; у части товаров не указана. */
    minQty?: string;
  };
  createdAt: string;
  /** Тайминги обработки, миллисекунды. Демка показывает их как есть. */
  timings: Record<string, number>;
}

/** Контракт репозитория. */
export interface ImageRepo {
  insert(record: Omit<ImageRecord, 'id' | 'createdAt'>): Promise<ImageRecord>;
  findById(id: string): Promise<ImageRecord | null>;
  findBySha(sha: string): Promise<ImageRecord | null>;
  list(): Promise<ImageRecord[]>;
}

/**
 * JSON-репозиторий с записью через временный файл и переименование.
 *
 * Переименование на одной файловой системе атомарно, поэтому параллельные
 * запросы не могут увидеть наполовину записанный файл. Полноценных транзакций
 * это не даёт — для демки достаточно, для прода нужен PostgreSQL.
 */
export class JsonRepo implements ImageRepo {
  private cache: ImageRecord[] | null = null;
  /** Очередь записи: сериализует конкурентные вставки в один поток. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<ImageRecord[]> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8')) as ImageRecord[];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private async flush(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.cache ?? [], null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  async insert(record: Omit<ImageRecord, 'id' | 'createdAt'>): Promise<ImageRecord> {
    const full: ImageRecord = { ...record, id: randomUUID(), createdAt: new Date().toISOString() };

    // Вставки выстраиваются в цепочку, иначе две параллельные загрузки
    // прочитают один и тот же массив и одна затрёт другую.
    const done = this.queue.then(async () => {
      const rows = await this.load();
      rows.push(full);
      await this.flush();
    });
    this.queue = done.catch(() => undefined);
    await done;

    return full;
  }

  async findById(id: string): Promise<ImageRecord | null> {
    return (await this.load()).find((r) => r.id === id) ?? null;
  }

  async findBySha(sha: string): Promise<ImageRecord | null> {
    return (await this.load()).find((r) => r.sha256 === sha) ?? null;
  }

  async list(): Promise<ImageRecord[]> {
    return [...(await this.load())].reverse();
  }
}

let repo: ImageRepo | null = null;

/** Возвращает singleton репозитория. */
export function useRepo(): ImageRepo {
  if (!repo) {
    const config = useRuntimeConfig();
    repo = new JsonRepo(path.join(config.storageRoot as string, '..', 'images.json'));
  }
  return repo;
}
