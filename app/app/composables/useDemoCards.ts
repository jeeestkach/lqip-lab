/**
 * Общая подготовка карточек для обеих демо-стратегий.
 *
 * Держим в одном месте, чтобы стратегии отличались ровно тем, чем должны —
 * моментом получения данных, — а не набором товаров, порядком или ценами.
 */

/** Параметры демонстрации, приходящие в адресе. */
export interface DemoParams {
  ph: string;
  repeat: number;
}

/** Читает параметры демонстрации из адреса страницы. */
export function useDemoParams(): DemoParams {
  const route = useRoute();
  const repeat = Number.parseInt(String(route.query.repeat ?? ''), 10);
  return reactive({
    ph: String(route.query.ph ?? '20'),
    repeat: Number.isFinite(repeat) && repeat > 0 ? repeat : 1,
  });
}

/**
 * Собирает блок стилей с плейсхолдерами — по одному правилу на изображение.
 *
 * Карточек может быть сколько угодно, изображений — ограниченное число.
 * Правило `.ph-<id>` подключается классом, поэтому один data URI обслуживает
 * все повторы, а не копируется в каждый инлайновый стиль: замер показал
 * 8 КБ переплаты за повторы при 14 уникальных изображениях.
 */
export function buildPlaceholderCss(cards: { phKey: string; placeholder: string }[]): string {
  const seen = new Map<string, string>();
  for (const c of cards) {
    if (c.placeholder && !seen.has(c.phKey)) seen.set(c.phKey, c.placeholder);
  }
  return [...seen].map(([id, ph]) => `.ph-${id}{--ph:url(${ph})}`).join('');
}

/**
 * Разворачивает записи API в карточки товара.
 *
 * Ссылки на изображения идут БЕЗ каких-либо параметров задержки: качает их сам
 * браузер, параллельно и на своей скорости. Прежняя очередь на JS вносила
 * искусственную паузу и лишала страницу предсканера — тот начинает тянуть
 * файлы ещё при разборе HTML, до выполнения любого скрипта.
 *
 * @param images Записи из `/api/images`.
 * @param params Параметры демонстрации.
 */
export function buildCards(images: any[] | undefined, params: DemoParams) {
  if (!images?.length) return [];
  return Array.from({ length: images.length * params.repeat }, (_, i) => {
    const src = images[i % images.length]!;
    // Карточная копия — 300 px по вёрстке, но srcset даёт браузеру выбрать
    // крупнее на экранах с высокой плотностью.
    const variant = src.variants.find((v: any) => v.width >= 300) ?? src.variants[0];
    return {
      id: src.id,
      key: `${src.id}-${i}`,
      index: i,
      title: src.title,
      width: src.width,
      height: src.height,
      placeholder: src.placeholder,
      /** Ключ правила в блоке стилей: один на изображение, а не на карточку. */
      phKey: src.id,
      url: variant.url,
      srcset: src.variants.map((v: any) => `${v.url} ${v.width}w`).join(', '),
      product: src.product,
    };
  });
}
