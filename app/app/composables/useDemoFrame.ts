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
  | { type: 'demo:payload'; strategy: string; payload: Payload }
  | { type: 'demo:milestones'; strategy: string; milestones: Milestones }
  | { type: 'demo:progress'; strategy: string; done: number; total: number; elapsed: number; bytes: number; fetching?: boolean };

/** Начальный объём страницы по видам ресурсов, байты. */
export interface Payload {
  document: number;
  css: number;
  js: number;
  /** Ответы API — для клиентской стратегии это обязательный шаг до первой отрисовки. */
  json: number;
  other: number;
  total: number;
  /** Сколько запросов пришлось сделать, не считая изображений. */
  requests: number;
}

/**
 * Вехи загрузки, миллисекунды от начала навигации.
 *
 * `firstPaint` намеренно НЕ считается главной метрикой: у клиентской стратегии
 * его вызывает надпись «Запрашиваю список», то есть пустая страница. Смотреть
 * надо на `cardsVisible` — момент, когда пользователь увидел товар.
 */
export interface Milestones {
  /** Документ полностью получен. */
  document: number;
  /** Первый нарисованный пиксель — любой, хоть надпись. */
  firstPaint: number;
  /** Карточки товара появились в разметке. Вот это и важно. */
  cardsVisible: number;
  /**
   * Первое изображение стало видно на месте картинки.
   *
   * Определение сознательно РАЗНОЕ у стратегий, и это не подтасовка:
   *   · SSR — момент отрисовки плейсхолдера. Он приезжает в HTML, поэтому
   *     на месте картинки сразу что-то есть, пусть и размытое;
   *   · клиентский рендер — приход первой настоящей фотографии, потому что
   *     до неё на месте картинки НЕТ НИЧЕГО, показывать нечего.
   *
   * Метрика отвечает на вопрос «когда пользователь перестал видеть пустоту»,
   * а не «когда пришёл файл» — сравнивать честнее именно так.
   */
  firstImagery: number;
  /**
   * Первая НАСТОЯЩАЯ фотография отрисована.
   *
   * Отличается от `firstImagery`: у серверной стратегии там плейсхолдер,
   * а здесь именно фотография. Нужна, чтобы сравнивать режимы загрузки
   * между собой — очередь под управлением JS против нативной загрузки браузером.
   */
  firstPhoto: number;
}

export interface DemoFrameOptions {
  /** Какая стратегия рендера здесь показана. */
  strategy: string;
  /** Родитель просит перезапустить показ. Кадр пересоздаётся целиком, поэтому пусто. */
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

  /**
   * Открыта ли страница внутри кадра сравнения.
   *
   * По умолчанию `false`, и это важно: сервер не знает, куда попадёт документ,
   * а значение, выставленное сразу, разошлось бы с серверной разметкой при
   * гидратации. Ставим после монтирования — тогда обе стороны совпадают.
   *
   * Вне кадра страница обязана прокручиваться сама: иначе до догрузки следующих
   * порций просто не добраться, и открыть демку отдельной вкладкой невозможно.
   */
  const embedded = ref(false);

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

  /**
   * Считает начальный объём: HTML, стили, скрипты и ответы API.
   *
   * Изображения СОЗНАТЕЛЬНО исключены — они одинаковы у обеих стратегий
   * и приезжают через отдельный маршрут. Интересна цена самого документа
   * и того, что нужно, чтобы его показать.
   *
   * `transferSize` — вес по проводу, со сжатием и заголовками. У кроссдоменных
   * ответов без `Timing-Allow-Origin` он равен нулю, но здесь всё своё.
   */
  function reportPayload() {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const p: Payload = {
      document: nav?.transferSize ?? 0,
      css: 0, js: 0, json: 0, other: 0, total: 0, requests: nav ? 1 : 0,
    };

    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (e.name.includes('/cdn/')) continue;
      const size = e.transferSize || e.encodedBodySize || 0;
      p.requests += 1;
      if (e.initiatorType === 'link' || /\.css(\?|$)/.test(e.name)) p.css += size;
      else if (e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)) p.js += size;
      else if (e.name.includes('/api/')) p.json += size;
      else p.other += size;
    }

    p.total = p.document + p.css + p.js + p.json + p.other;
    post({ type: 'demo:payload', strategy: opts.strategy, payload: p });
  }

  /**
   * Сообщает вехи загрузки. Вызывается страницей, когда карточки отрисованы.
   * Отсчёт от начала навигации, поэтому цифры сравнимы между кадрами.
   */
  /** Момент, когда на месте картинки впервые что-то появилось. */
  let firstImagery = 0;
  /** Момент, когда стали видны карточки товара. */
  let cardsVisible = 0;
  /** Момент прихода первой настоящей фотографии. */
  let firstPhoto = 0;

  /** Время первого пейнта, если он уже случился. */
  function firstPaintTime(): number | null {
    const p = performance.getEntriesByType('paint').find((x) => x.name === 'first-contentful-paint');
    return p ? Math.round(p.startTime) : null;
  }

  /**
   * Отмечает первое видимое изображение. Повторные вызовы игнорируются.
   *
   * @param atFirstPaint Брать время первого пейнта вместо текущего.
   *   Нужно для серверного рендера: плейсхолдеры лежат в самом HTML и рисуются
   *   ВМЕСТЕ с первым пейнтом, задолго до гидратации. Отмечать их моментом
   *   гидратации значило бы занижать стратегию на время загрузки и разбора JS.
   */
  function markFirstImagery(atFirstPaint = false) {
    if (firstImagery) return;
    firstImagery = (atFirstPaint ? firstPaintTime() : null) ?? Math.round(performance.now());
    reportMilestones();
  }

  /** Отмечает первую отрисованную фотографию. Повторные вызовы игнорируются. */
  function markFirstPhoto() {
    if (firstPhoto) return;
    firstPhoto = Math.round(performance.now());
    reportMilestones();
  }

  /**
   * Отмечает появление карточек товара.
   * @param atFirstPaint Для серверного рендера — да: карточки лежат в HTML
   *   и видны с первого пейнта, а не с момента гидратации.
   */
  function markCardsVisible(atFirstPaint = false) {
    if (cardsVisible) return;
    cardsVisible = (atFirstPaint ? firstPaintTime() : null) ?? Math.round(performance.now());
    reportMilestones();
  }

  function reportMilestones() {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    post({
      type: 'demo:milestones',
      strategy: opts.strategy,
      milestones: {
        document: Math.round(nav?.responseEnd ?? 0),
        firstPaint: Math.round(paint?.startTime ?? 0),
        cardsVisible: cardsVisible || Math.round(performance.now()),
        firstImagery,
        firstPhoto,
      },
    });
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
    embedded.value = window.parent !== window;
    window.addEventListener('message', onMessage);

    // Высота меняется, когда приходят карточки и когда картинки занимают место.
    observer = new ResizeObserver(reportHeight);
    const target = document.querySelector('.demo-page');
    if (target) observer.observe(target);

    post({ type: 'demo:ready', strategy: opts.strategy });
    reportHeight();

    // Считаем дважды: сразу и после того, как страница договорит своё
    // (клиентской стратегии нужен ещё запрос к API — он тоже должен попасть в счёт).
    reportPayload();
    setTimeout(reportPayload, 1500);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
  });

  return { post, offset, embedded, reportMilestones, markFirstImagery, markCardsVisible, markFirstPhoto };
}
