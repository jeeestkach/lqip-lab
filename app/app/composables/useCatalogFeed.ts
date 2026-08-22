/**
 * Лента каталога: первая порция плюс догрузка по мере прокрутки.
 *
 * Обе стратегии показывают одинаково 40 карточек и одинаково просят следующие
 * 40, не доходя до низа. Разница между ними — только в том, ОТКУДА взялась
 * первая порция: серверный рендер получает её вместе с документом, клиентский
 * идёт за ней запросом уже после загрузки скриптов.
 *
 * Порция намеренно небольшая: документ, в котором лежат все полтораста товаров,
 * весит втрое больше, а видно из него шесть карточек.
 */

import type { DemoCard } from './useDemoCards';

export interface CatalogFeedOptions {
  /** Карточки первой порции — уже собранные. */
  initial: DemoCard[];
  /** Сколько всего товаров в каталоге. */
  total: number;
  /** Ширина плейсхолдера, которую просим у API. */
  ph: string;
  /** Размер порции. */
  pageSize: number;
  /** Смещение прокрутки, присланное родителем. Внутри iframe — единственный источник. */
  offset: Ref<number>;
}

/**
 * Доля прокрутки, после которой заказывается следующая порция.
 *
 * Запрашиваем не у самого низа, а за 30 % до него: пока порция едет, читателю
 * есть что листать, и подстановка происходит вне поля зрения.
 */
const THRESHOLD = 0.7;

/**
 * Подключает догрузку к прокрутке.
 * @returns `cards` — вся лента; `total` — сколько товаров всего; `loading` — идёт ли запрос.
 */
export function useCatalogFeed(opts: CatalogFeedOptions) {
  const cards = ref<DemoCard[]>([...opts.initial]);
  const total = ref(opts.total);
  const loading = ref(false);

  /** Всё ли уже показано. */
  const exhausted = computed(() => cards.value.length >= total.value);

  /**
   * Позиция прокрутки.
   *
   * Внутри кадра своей прокрутки нет — содержимое сдвигает родитель, и правду
   * знает только он. Открытая отдельно страница прокручивается обычным образом.
   */
  function scrolled(): number {
    return window.parent !== window ? opts.offset.value : window.scrollY;
  }

  /** Подошли ли к низу настолько, чтобы просить следующую порцию. */
  function nearBottom(): boolean {
    const el = document.querySelector('.demo-page');
    if (!el) return false;
    const content = el.getBoundingClientRect().height;
    const view = window.innerHeight;
    // Содержимое не заполнило экран — прокручивать нечего, просим сразу.
    if (content <= view) return true;
    return (scrolled() + view) / content >= THRESHOLD;
  }

  async function loadMore(): Promise<void> {
    if (loading.value || exhausted.value) return;
    loading.value = true;
    try {
      const d = await $fetch<any>('/api/images', {
        query: { ph: opts.ph, catalog: 1, offset: cards.value.length, limit: opts.pageSize },
      });
      total.value = d?.total ?? total.value;
      cards.value.push(...buildCards(d?.images, cards.value.length));
    } catch {
      // Сеть подвела — оставляем что есть; следующая прокрутка попробует снова.
    } finally {
      loading.value = false;
    }

    /*
     * Порция могла не дотянуть до порога — например, окно высокое, а карточки
     * низкие. Без этой проверки лента замерла бы: прокручивать нечего, а значит
     * и события, которое запустит следующий запрос, не будет.
     */
    await nextTick();
    if (!exhausted.value && nearBottom()) await loadMore();
  }

  function check() {
    if (nearBottom()) void loadMore();
  }

  onMounted(() => {
    // Кадр прокрутки не получает, поэтому слушаем и то и другое: обычную
    // прокрутку для отдельно открытой страницы и смещение от родителя для кадра.
    window.addEventListener('scroll', check, { passive: true });
    check();
  });

  onBeforeUnmount(() => window.removeEventListener('scroll', check));

  watch(() => opts.offset.value, check);

  return { cards, total, loading, exhausted, loadMore };
}
