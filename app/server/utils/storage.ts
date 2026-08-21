/**
 * Слой хранилища объектов. Интерфейс намеренно повторяет подмножество S3
 * (put/get/exists по ключу), чтобы файловый драйвер можно было заменить на
 * настоящий S3/MinIO, не трогая ни конвейер обработки, ни API.
 *
 * Ключи всегда вида `<префикс>/<sha256>/<имя>` — плоское пространство имён,
 * без вложенности по датам: дедупликация идёт по содержимому, а не по времени.
 */

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Контракт хранилища. Реализаций две: файловая и (в будущем) S3. */
export interface ObjectStorage {
  /** Кладёт объект по ключу. Идемпотентно: повторная запись тем же ключом безопасна. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Читает объект. Бросает, если ключа нет. */
  get(key: string): Promise<Buffer>;
  /** Есть ли объект под таким ключом. */
  exists(key: string): Promise<boolean>;
  /** Публичный URL объекта — то, что уедет клиенту как ссылка на CDN. */
  url(key: string): string;
}

/**
 * Файловый драйвер: объекты лежат в каталоге, отдаются маршрутом `/cdn/*`.
 *
 * Для локальной демки это полный эквивалент CDN с точки зрения клиента —
 * он видит обычный URL и ничего не знает о том, что за ним файловая система.
 */
export class FsStorage implements ObjectStorage {
  /**
   * @param root Каталог на диске, куда складываются объекты.
   * @param publicPrefix Префикс публичного URL, по которому объекты отдаются.
   */
  constructor(
    private readonly root: string,
    private readonly publicPrefix = '/cdn',
  ) {}

  /** Абсолютный путь объекта на диске. */
  private resolve(key: string): string {
    // Ключи формируются внутри приложения, но проверка обязательна:
    // ключ из внешнего запроса не должен уводить за пределы корня.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`недопустимый ключ объекта: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  url(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }
}

let storage: ObjectStorage | null = null;

/**
 * Возвращает singleton хранилища, настроенный из runtime-конфига.
 *
 * Имя НЕ `useStorage`: так называется встроенный в Nitro доступ к его KV-слою,
 * и одноимённый авто-импорт молча перекрыл бы фреймворковый — с сюрпризом в тот
 * момент, когда он реально понадобится.
 */
export function useObjectStorage(): ObjectStorage {
  if (!storage) {
    const config = useRuntimeConfig();
    storage = new FsStorage(config.storageRoot as string);
  }
  return storage;
}
