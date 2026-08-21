/**
 * Общая подготовка карточек для обеих демо-стратегий.
 *
 * Держим в одном месте, чтобы стратегии отличались ровно тем, чем должны —
 * моментом получения данных, — а не набором товаров, порядком или ценами.
 */

/** Параметры демонстрации, приходящие в адресе. */
export interface DemoParams {
  speed: string;
  ph: string;
  repeat: number;
  concurrency: number;
}

/** Читает параметры демонстрации из адреса страницы. */
export function useDemoParams(): DemoParams {
  const route = useRoute();
  const num = (v: unknown, d: number) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return reactive({
    speed: String(route.query.speed ?? 'slow4g'),
    ph: String(route.query.ph ?? '20'),
    repeat: num(route.query.repeat, 3),
    concurrency: num(route.query.concurrency, 1),
  });
}

/**
 * Разворачивает записи API в карточки товара.
 * @param images Записи из `/api/images`.
 * @param params Параметры демонстрации.
 */
export function buildCards(images: any[] | undefined, params: DemoParams) {
  if (!images?.length) return [];
  return Array.from({ length: images.length * params.repeat }, (_, i) => {
    const src = images[i % images.length]!;
    const variant = src.variants.find((v: any) => v.width >= 300) ?? src.variants[0];
    return {
      id: src.id,
      key: `${src.id}-${i}`,
      index: i,
      title: src.title,
      width: src.width,
      height: src.height,
      // Ширину выбрал сервер по параметру `ph` — лишних сюда не приходит.
      placeholder: src.placeholder,
      price: 350 + i * 37,
      url: `${variant.url}?speed=${params.speed}`,
      bytes: variant.bytes,
    };
  });
}
