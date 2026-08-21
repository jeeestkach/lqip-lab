/**
 * Связь демо-страницы с родительским окном сравнения.
 *
 * Демо-страницы открыты в iframe как самостоятельные документы. Родитель
 * дирижирует прогоном, собирает статистику и прокручивает оба кадра.
 *
 * Прокрутка устроена односторонне и намеренно: внутри кадра она СКРЫТА
 * (`overflow: hidden` на теле документа), кадр сам никуда не прокручивается
 * и о своей прокрутке никому не сообщает — он лишь исполняет `demo:scrollTo`
 * от родителя. Взаимной синхронизации «кадр рассказал соседу» здесь нет,
 * и рассказывать нечего: единственный источник правды — полоса родителя.
 * Двусторонний вариант неизбежно порождал бы петлю (A сдвинулся → сказал
 * родителю → тот сказал B → B сдвинулся → сказал родителю → тот вернул A).
 *
 * Взамен кадр обязан сообщать высоту своего содержимого: по ней родитель
 * задаёт длину фальшивой полосы прокрутки. Высота меняется по ходу прогона —
 * у клиентской стратегии карточек сначала нет вовсе.
 */

/** Сообщения, которые кадр шлёт наверх. */
type Outgoing =
  | { type: 'demo:ready'; strategy: string }
  | { type: 'demo:height'; strategy: string; height: number }
  | { type: 'demo:progress'; strategy: string; done: number; total: number; elapsed: number; bytes: number; fetching?: boolean };

export interface DemoFrameOptions {
  /** Какая стратегия рендера здесь показана. */
  strategy: string;
  /** Родитель просит начать прогон заново. */
  onRun: () => void;
  /** Родитель просит остановиться. */
  onStop: () => void;
}

/**
 * Подключает кадр к родителю.
 * @returns `post` — отправка сообщения наверх.
 */
export function useDemoFrame(opts: DemoFrameOptions) {
  const post = (msg: Outgoing) => window.parent?.postMessage(msg, '*');

  /** Смещение, заданное родителем. Применяется к содержимому, а не к окну. */
  const offset = ref(0);

  let observer: ResizeObserver | null = null;
  let lastHeight = 0;

  /**
   * Меряем САМО содержимое, а не документ: содержимое лежит в фиксированной
   * обёртке и в поток не попадает, поэтому `documentElement.scrollHeight`
   * показывал бы высоту окна, а не карточек.
   */
  function reportHeight() {
    const el = document.querySelector('.demo-page');
    if (!el) return;
    const height = Math.ceil(el.getBoundingClientRect().height);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    post({ type: 'demo:height', strategy: opts.strategy, height });
  }

  function onMessage(e: MessageEvent) {
    const d = e.data;
    if (d === 'demo:run') return opts.onRun();
    if (d === 'demo:stop') return opts.onStop();
    if (d?.type === 'demo:scrollTo' && typeof d.top === 'number') {
      offset.value = d.top;
    }
  }

  onMounted(() => {
    window.addEventListener('message', onMessage);

    // Высота меняется, когда приходят карточки и когда картинки занимают место.
    observer = new ResizeObserver(reportHeight);
    const target = document.querySelector('.demo-page');
    if (target) observer.observe(target);

    post({ type: 'demo:ready', strategy: opts.strategy });
    reportHeight();
  });

  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
  });

  return { post, offset };
}
