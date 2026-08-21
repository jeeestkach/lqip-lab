/**
 * Симулятор загрузки изображений при ограниченном канале.
 *
 * Зачем не троттлинг DevTools и не задержка на сервере: и то и другое даёт
 * ОДИНАКОВУЮ паузу каждому файлу, а в жизни время зависит от веса картинки
 * и от того, что канал делится между параллельными загрузками. Именно из-за
 * этого карточки на реальном каталоге появляются неровными кусками, а не разом.
 *
 * Модель: браузер держит к одному источнику ограниченное число соединений,
 * каждое получает свою долю полосы. Файл встаёт в очередь, занимает
 * освободившееся соединение и грузится время `вес / доля_полосы + задержка`.
 *
 * Управление показом — на стороне JS: `<img>` получает `src` не сразу,
 * а в момент, посчитанный моделью. Поэтому прогон точен и повторяем,
 * а кеш браузера ему не мешает.
 */

/** Профили соединения. Числа — канонические из троттлинга Chrome DevTools. */
export const SPEEDS = [
  { key: 'slow3g', label: 'Медленный 3G', bps: 400_000, rtt: 400, hint: '400 Кбит/с · 400 мс' },
  { key: 'slow4g', label: 'Медленный 4G', bps: 1_600_000, rtt: 150, hint: '1,6 Мбит/с · 150 мс' },
  { key: 'fast4g', label: 'Быстрый 4G', bps: 9_000_000, rtt: 85, hint: '9 Мбит/с · 85 мс' },
  { key: 'wifi', label: 'Быстрый интернет', bps: 50_000_000, rtt: 20, hint: '50 Мбит/с · 20 мс' },
] as const;

export type SpeedKey = (typeof SPEEDS)[number]['key'];

/**
 * Сколько одновременных соединений браузер держит к одному источнику.
 * Для HTTP/1.1 это шесть — та самая причина, по которой картинки приходят
 * пачками по шесть, а не все сразу.
 */
const PARALLEL = 6;

/** Элемент очереди загрузки. */
export interface LoadItem {
  key: string;
  bytes: number;
}

/**
 * Управляет прогоном загрузки.
 * @returns Реактивное состояние и методы `start` / `stop`.
 */
export function useLoadSimulator() {
  /** Ключи файлов, которые «пришли» по модели. */
  const arrived = ref(new Set<string>());
  /** Идёт ли прогон. */
  const running = ref(false);
  /** Прошло миллисекунд с начала прогона. */
  const elapsed = ref(0);
  /** Сколько всего файлов в текущем прогоне. */
  const total = ref(0);
  /** Ожидаемое время до последнего файла, мс. */
  const eta = ref(0);

  let timers: ReturnType<typeof setTimeout>[] = [];
  let ticker: ReturnType<typeof setInterval> | null = null;

  /** Снимает все запланированные события и останавливает часы. */
  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    if (ticker) clearInterval(ticker);
    ticker = null;
    running.value = false;
  }

  /**
   * Планирует приход файлов по модели общей полосы.
   * @param items Файлы в порядке появления в разметке.
   * @param speed Выбранный профиль соединения.
   */
  function start(items: LoadItem[], speed: (typeof SPEEDS)[number]) {
    stop();
    arrived.value = new Set();
    elapsed.value = 0;
    total.value = items.length;
    running.value = true;

    // Каждое соединение получает свою долю полосы; slots хранит момент,
    // когда соединение освободится.
    const share = speed.bps / PARALLEL;
    const slots = new Array(PARALLEL).fill(0);
    let last = 0;

    for (const item of items) {
      const slot = slots.indexOf(Math.min(...slots));
      const durationMs = ((item.bytes * 8) / share) * 1000 + speed.rtt;
      const finish = slots[slot]! + durationMs;
      slots[slot] = finish;
      last = Math.max(last, finish);

      timers.push(
        setTimeout(() => {
          // Пересоздаём Set: мутация вложенного Set не всегда триггерит
          // перерисовку списка из полусотни элементов предсказуемо.
          arrived.value = new Set(arrived.value).add(item.key);
        }, finish),
      );
    }

    eta.value = Math.round(last);

    const startedAt = performance.now();
    ticker = setInterval(() => {
      elapsed.value = Math.round(performance.now() - startedAt);
      if (elapsed.value >= last) stop();
    }, 100);
  }

  onScopeDispose(stop);

  return { arrived, running, elapsed, total, eta, start, stop };
}
