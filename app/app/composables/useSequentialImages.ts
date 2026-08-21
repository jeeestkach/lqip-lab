/**
 * Последовательная загрузка изображений под контролем JS.
 *
 * ── Почему не «прогреть кеш и подставить src» ──────────────────────────────
 *
 * Напрашивающийся приём — создать `new Image()`, дождаться `onload`, а потом
 * присвоить `src` настоящему тегу в расчёте на то, что второй запрос уйдёт
 * в кеш. Приём рабочий, но держится на трёх допущениях, каждое из которых
 * ломается:
 *
 *   1. Ответ должен быть кешируемым. При `Cache-Control: no-store` второе
 *      присваивание уходит в СЕТЬ заново — и «мгновенная подстановка» снова
 *      занимает столько же, сколько первая загрузка. А замедленные ответы
 *      как раз обязаны быть `no-store`, иначе не переиграть демонстрацию.
 *   2. Даже при разрешённом кешировании гарантии нет: запись на диск может
 *      отстать, запись может быть вытеснена, у пользователя может быть
 *      выключен дисковый кеш.
 *   3. Реальный вес и время передачи так не измерить — браузер их не расскажет.
 *
 * ── Что делаем вместо этого ────────────────────────────────────────────────
 *
 * `fetch` → `blob` → `URL.createObjectURL`. Байты лежат в памяти, ссылка
 * создаётся синхронно, подстановка гарантированно мгновенна и не зависит ни от
 * кеша, ни от его заголовков. Заодно виден настоящий размер ответа.
 *
 * Перед снятием блюра ждём `img.decode()`: файл может быть уже получен, но ещё
 * не декодирован, и подмена без ожидания даёт заметный рывок на слабых машинах.
 *
 * Плата: `object URL` держит байты в памяти, поэтому их обязательно освобождать
 * (`revoke`), и такой путь не умеет `srcset` — вариант выбирает вызывающий код.
 */

/** Что грузим. */
export interface ImageJob {
  key: string;
  url: string;
}

/** Состояние одной загрузки. */
export interface ImageState {
  /** Ссылка на полученные байты; пусто, пока не пришло. */
  objectUrl: string;
  /** Сколько байт реально приехало. */
  bytes: number;
  /** Сколько миллисекунд заняло от старта запроса до готовности к показу. */
  ms: number;
}

/**
 * Управляет очередью загрузки.
 * @returns Реактивное состояние и методы `start` / `stop`.
 */
export function useSequentialImages() {
  /** Готовые изображения по ключу. */
  const done = ref(new Map<string, ImageState>());
  const running = ref(false);
  const total = ref(0);
  const elapsed = ref(0);
  /** Суммарно принято байт. */
  const bytes = ref(0);

  let abort: AbortController | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  /** Освобождает удерживаемые байты. Без этого утечёт память. */
  function release() {
    done.value.forEach((s) => URL.revokeObjectURL(s.objectUrl));
    done.value = new Map();
  }

  function stop() {
    abort?.abort();
    abort = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
    running.value = false;
  }

  /**
   * Запускает загрузку.
   * @param jobs Файлы в том порядке, в каком они должны появляться.
   * @param concurrency Сколько запросов держать одновременно.
   *   1 — строго по очереди, слева направо и сверху вниз.
   *   6 — как браузер к одному источнику по HTTP/1.1.
   */
  async function start(jobs: ImageJob[], concurrency = 1) {
    stop();
    release();

    abort = new AbortController();
    const signal = abort.signal;
    const startedAt = performance.now();

    running.value = true;
    total.value = jobs.length;
    elapsed.value = 0;
    bytes.value = 0;

    ticker = setInterval(() => {
      elapsed.value = Math.round(performance.now() - startedAt);
    }, 100);

    let next = 0;

    /** Одна «дорожка»: берёт следующую работу, пока они не кончатся. */
    async function worker() {
      while (next < jobs.length && !signal.aborted) {
        const job = jobs[next++]!;
        const t0 = performance.now();
        try {
          const res = await fetch(job.url, { signal });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (signal.aborted) return;

          const objectUrl = URL.createObjectURL(blob);

          // Декодируем ДО показа: иначе подмена происходит в момент, когда
          // картинка ещё не готова к отрисовке, и на слабой машине виден рывок.
          try {
            const probe = new Image();
            probe.src = objectUrl;
            await probe.decode();
          } catch {
            // Декодер мог отказаться (битый файл) — покажем как есть.
          }
          if (signal.aborted) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          bytes.value += blob.size;
          // Пересоздаём Map: мутация вложенной коллекции не всегда надёжно
          // перерисовывает список из сотни элементов.
          done.value = new Map(done.value).set(job.key, {
            objectUrl,
            bytes: blob.size,
            ms: Math.round(performance.now() - t0),
          });
        } catch {
          // Прогон прерван или сеть отвалилась — просто идём дальше.
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

    if (!signal.aborted) stop();
  }

  onScopeDispose(() => {
    stop();
    release();
  });

  return { done, running, total, elapsed, bytes, start, stop };
}
