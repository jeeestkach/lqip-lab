<script setup lang="ts">
/**
 * Стратегия 2: серверный рендер с обогащением.
 *
 * Сервер отдаёт готовый HTML, в котором УЖЕ есть карточки, размеры, размытые
 * плейсхолдеры и настоящие теги `<img>` со ссылками. Клиенту не нужно ничего
 * запрашивать, чтобы показать выдачу.
 *
 * Главный выигрыш даёт не сам плейсхолдер, а предсканер браузера: он находит
 * `src` прямо в разметке и начинает качать файлы ещё при разборе HTML,
 * до выполнения хоть строки JS. Клиентская стратегия дотуда доберётся только
 * после загрузки скриптов и ответа API.
 */

definePageMeta({ layout: false });

useHead({
  title: 'Каталог товаров — SSR',
  meta: [{ name: 'description', content: 'Каталог: карточки, цены и размытые превью приходят готовыми в HTML.' }],
});

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
const { data: cards } = await useFetch('/api/images', {
  query: { ph: params.ph },
  transform: (d: any) => {
    const built = buildCards(d?.images, params);
    if (import.meta.server) placeholderCss = buildPlaceholderCss(built);
    return built.map(({ placeholder, ...rest }: any) => rest);
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

const { offset, markFirstImagery, markCardsVisible } = useDemoFrame({
  strategy: 'ssr',
  onRun: () => undefined,
  onStop: () => undefined,
});

watch(
  () => (cards.value ?? []).length,
  (n) => {
    if (!n) return;
    // И карточки, и плейсхолдеры лежат в серверном HTML: они нарисованы вместе
    // с первым пейнтом, ЗАДОЛГО до гидратации. Отмечать их моментом гидратации
    // значило бы приписать стратегии чужое время — загрузку и разбор скриптов.
    nextTick(() => requestAnimationFrame(() => { markCardsVisible(true); markFirstImagery(true); }));
  },
  { immediate: true },
);
</script>

<template>
  <div class="demo-viewport">
    <div class="demo-page" :style="{ transform: `translateY(${-offset}px)` }">
      <DemoGrid :cards="cards ?? []" :with-placeholder="true" />
    </div>
  </div>
</template>

<style scoped>
.demo-viewport { position: fixed; inset: 0; overflow: hidden; }
.demo-page { padding: 12px; will-change: transform; }
</style>
