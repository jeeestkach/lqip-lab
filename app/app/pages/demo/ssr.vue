<script setup lang="ts">
/**
 * Стратегия 2: серверный рендер с обогащением.
 *
 * Сервер отдаёт готовый HTML, в котором УЖЕ есть первые 40 карточек: размеры,
 * размытые превью и настоящие теги `<img>` со ссылками. Чтобы показать выдачу,
 * клиенту не нужно ничего запрашивать.
 *
 * Главный выигрыш даёт не сам плейсхолдер, а предсканер браузера: он находит
 * `src` прямо в разметке и начинает качать файлы ещё при разборе HTML,
 * до выполнения хоть строки JS. Клиентская стратегия дотуда доберётся только
 * после загрузки скриптов и ответа API.
 *
 * Остальные товары догружаются порциями по мере прокрутки — как и у клиентской
 * стратегии. Класть все полтораста в документ бессмысленно: он вырос бы втрое,
 * а видно из него по-прежнему шесть карточек.
 */

definePageMeta({ layout: false });

useHead({
  title: 'Каталог товаров — SSR',
  meta: [{ name: 'description', content: 'Каталог: карточки, цены и размытые превью приходят готовыми в HTML.' }],
});

/** Размер порции — и первой, серверной, и всех догруженных. */
const PAGE_SIZE = 40;

const params = useDemoParams();

/**
 * Блок стилей с плейсхолдерами. Собирается на сервере и НЕ попадает в payload.
 *
 * Плейсхолдеры нужны только для отрисовки: размытие рисует CSS, и клиенту после
 * гидратации сами строки не нужны ни для чего. Замер показал, что в payload они
 * занимали 3,9 КБ мёртвым грузом.
 */
let placeholderCss = '';

// Данные берутся НА СЕРВЕРЕ, поэтому карточки попадают в HTML.
// `transform` выполняется там же — в payload уезжает результат, а не сырой
// ответ API со всеми ширинами плейсхолдера и лишними полями.
const { data } = await useFetch('/api/images', {
  query: { ph: params.ph, catalog: 1, offset: 0, limit: PAGE_SIZE },
  transform: (d: any) => {
    const built = buildCards(d?.images, 0);
    if (import.meta.server) placeholderCss = buildPlaceholderCss(built);
    return {
      total: d?.total ?? built.length,
      // Превью уже уехали в блок стилей — в payload их незачем повторять.
      cards: built.map(({ placeholder, ...rest }) => rest),
    };
  },
});

/*
 * `useServerHead`, а не `useHead`: серверный вариант не переносит содержимое
 * в payload и не применяет его повторно на клиенте. Ровно то, что нужно —
 * стили должны приехать в документе и там остаться.
 */
if (placeholderCss) {
  useServerHead({ style: [{ innerHTML: placeholderCss }] });
}

const { offset, embedded, markFirstImagery, markCardsVisible } = useDemoFrame({
  strategy: 'ssr',
  onRun: () => undefined,
  onStop: () => undefined,
});

const { cards, total, loading } = useCatalogFeed({
  initial: data.value?.cards ?? [],
  total: data.value?.total ?? 0,
  ph: params.ph,
  pageSize: PAGE_SIZE,
  offset,
});

watch(
  () => cards.value.length,
  (n) => {
    // Только в браузере: на сервере карточки есть сразу, watcher с `immediate`
    // срабатывает там же, а ни requestAnimationFrame, ни window там не существует.
    // Без этой проверки рендер падал необработанным отказом.
    if (!n || !import.meta.client) return;
    // И карточки, и плейсхолдеры лежат в серверном HTML: они нарисованы вместе
    // с первым пейнтом, ЗАДОЛГО до гидратации. Отмечать их моментом гидратации
    // значило бы приписать стратегии чужое время — загрузку и разбор скриптов.
    nextTick(() => requestAnimationFrame(() => { markCardsVisible(true); markFirstImagery(true); }));
  },
  { immediate: true },
);
</script>

<template>
  <div class="demo-viewport" :class="{ 'is-embedded': embedded }">
    <div class="demo-page" :style="embedded ? { transform: `translateY(${-offset}px)` } : undefined">
      <DemoGrid :cards="cards" :with-placeholder="true" />
      <p class="demo-foot">
        <template v-if="loading">Догружаю следующие {{ PAGE_SIZE }}…</template>
        <template v-else-if="cards.length >= total">Показаны все {{ total }} товаров</template>
        <template v-else>{{ cards.length }} из {{ total }}</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
/*
 * Клип локальный, а не через `html, body { overflow: hidden }`: незакрытый
 * блок стилей утекает в документ родителя и ломает прокрутку страницы сравнения.
 * Открытая отдельно страница прокручивается обычным образом — иначе до догрузки
 * было бы не добраться.
 */
.demo-viewport.is-embedded { position: fixed; inset: 0; overflow: hidden; }
.demo-page { padding: 12px; will-change: transform; }
.demo-foot { color: var(--dim); font-size: 12px; text-align: center; padding: 14px 0 4px; }
</style>
