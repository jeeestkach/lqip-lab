/**
 * Общая подготовка карточек для обеих демо-стратегий.
 *
 * Держим в одном месте, чтобы стратегии отличались ровно тем, чем должны —
 * моментом получения данных, — а не набором товаров, порядком или ценами.
 */

/** Карточка товара в том виде, в каком её ждёт сетка. */
export interface DemoCard {
  id: string;
  key: string;
  /** Сквозной номер по всей ленте: по нему решается, грузить ли сразу. */
  index: number;
  title: string;
  width: number;
  height: number;
  /** Готовый data URI размытого превью. У серверной первой порции его нет. */
  placeholder?: string;
  /** Ключ правила `.ph-<id>` в блоке стилей, который прислал сервер. */
  phKey: string;
  /** Единственный адрес изображения: `srcset` карточке не нужен. */
  url: string;
  product?: {
    href: string;
    supplier: string;
    supplierLogo?: string;
    supplierBadge?: string;
    price: string;
    minQty?: string;
  };
}

/** Параметры демонстрации, приходящие в адресе. */
export interface DemoParams {
  ph: string;
}

/** Читает параметры демонстрации из адреса страницы. */
export function useDemoParams(): DemoParams {
  const route = useRoute();
  return reactive({ ph: String(route.query.ph ?? '20') });
}

/**
 * Собирает блок стилей с плейсхолдерами — по одному правилу на изображение.
 *
 * Правило `.ph-<id>` подключается классом, а не инлайновым стилем: так один
 * data URI обслуживает карточку любой вложенности, и повторы не копируют его
 * в разметку. Применяется только к первой порции — её рисует сервер.
 */
export function buildPlaceholderCss(cards: { phKey: string; placeholder?: string }[]): string {
  const seen = new Map<string, string>();
  for (const c of cards) {
    if (c.placeholder && !seen.has(c.phKey)) seen.set(c.phKey, c.placeholder);
  }
  return [...seen].map(([id, ph]) => `.ph-${id}{--ph:url(${ph})}`).join('');
}

/**
 * Разворачивает записи API в карточки товара.
 *
 * Ссылки идут БЕЗ параметров задержки: изображения качает сам браузер,
 * параллельно и на своей скорости. Очередь на JS вносила искусственную паузу
 * и лишала страницу предсканера — тот начинает тянуть файлы ещё при разборе
 * HTML, до выполнения любого скрипта.
 *
 * @param images Записи из `/api/images`.
 * @param startIndex Сколько карточек уже в ленте — чтобы номера не начинались
 *   заново в каждой догруженной порции.
 */
export function buildCards(images: any[] | undefined, startIndex = 0): DemoCard[] {
  return (images ?? []).map((src, i) => ({
    id: src.id,
    key: src.id,
    index: startIndex + i,
    title: src.title,
    width: src.width,
    height: src.height,
    placeholder: src.placeholder,
    /** Ключ правила в блоке стилей: один на изображение, а не на карточку. */
    phKey: src.id,
    url: src.url,
    product: src.product,
  }));
}
