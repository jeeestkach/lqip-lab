<script setup lang="ts">
/**
 * Стратегия 1: только клиентский рендер.
 *
 * Сервер отдаёт HTML БЕЗ карточек — пустую оболочку. Дальше по шагам:
 *   1. браузер получает и разбирает HTML, качает и исполняет JS;
 *   2. клиент запрашивает первую порцию `/api/images`;
 *   3. приходят данные — только теперь появляются карточки;
 *   4. и только теперь браузер видит теги `<img>` и начинает качать файлы.
 *
 * Дальше всё как у серверной стратегии: следующие порции по мере прокрутки.
 * Разница между стратегиями — ровно в первой порции, и только в ней.
 *
 * Изображения грузятся ОБЫЧНЫМ образом: `src`, параллельно, силами браузера,
 * без очередей и искусственных задержек. Проигрыш этой стратегии — не в
 * скорости самих картинок, а в том, что до третьего шага показывать нечего,
 * и запросы за ними даже не начинаются.
 */

definePageMeta({ layout: false });

useHead({
  title: 'Каталог товаров — клиентский рендер',
  meta: [{ name: 'description', content: 'Каталог: список запрашивается браузером после загрузки скриптов.' }],
});

/** Размер порции — такой же, как у серверной стратегии. */
const PAGE_SIZE = 40;

const params = useDemoParams();

// `server: false` — запрос уходит ТОЛЬКО из браузера, после гидратации.
// Это и есть клиентская стратегия: сервер о списке товаров ничего не знает.
const { data } = await useFetch('/api/images', {
  query: { ph: params.ph, catalog: 1, offset: 0, limit: PAGE_SIZE },
  server: false,
  lazy: true,
  transform: (d: any) => ({ total: d?.total ?? 0, cards: buildCards(d?.images, 0) }),
});

const { offset, embedded, markFirstImagery, markCardsVisible } = useDemoFrame({
  strategy: 'csr',
  onRun: () => undefined,
  onStop: () => undefined,
});

const { cards, total, loading } = useCatalogFeed({
  initial: [],
  total: 0,
  ph: params.ph,
  pageSize: PAGE_SIZE,
  offset,
});

/*
 * Первая порция приходит отдельным запросом, а не через ленту: только так видно
 * настоящую цену стратегии — ожидание скриптов и круговой ход к API. Дальше
 * лента ведёт себя точно так же, как у серверного рендера.
 */
watch(
  () => data.value,
  (d) => {
    // `import.meta.client` — не перестраховка: watcher с `immediate` срабатывает
    // и на сервере, где нет ни requestAnimationFrame, ни window.
    if (!import.meta.client || !d?.cards.length || cards.value.length) return;
    cards.value = d.cards;
    total.value = d.total;
    // Вехи снимаются, когда карточки появились в разметке. Обёртка обязательна:
    // requestAnimationFrame передаёт колбэку метку времени, и она попала бы
    // в первый параметр как `atFirstPaint = true`.
    nextTick(() => requestAnimationFrame(() => { markCardsVisible(); markFirstImagery(); }));
  },
  { immediate: true },
);
</script>

<template>
  <div class="demo-viewport" :class="{ 'is-embedded': embedded }">
    <div class="demo-page" :style="embedded ? { transform: `translateY(${-offset}px)` } : undefined">
      <!--
        Текст намеренно не зависит от статуса запроса: на сервере он ещё 'idle',
        на клиенте сразу 'pending', и разметка разошлась бы при гидратации.
      -->
      <p v-if="!cards.length" class="demo-empty">Запрашиваю список товаров…</p>
      <template v-else>
        <DemoGrid :cards="cards" :with-placeholder="true" />
        <p class="demo-foot">
          <template v-if="loading">Догружаю следующие {{ PAGE_SIZE }}…</template>
          <template v-else-if="cards.length >= total">Показаны все {{ total }} товаров</template>
          <template v-else>{{ cards.length }} из {{ total }}</template>
        </p>
      </template>
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
.demo-empty { color: var(--dim); font-size: 13px; padding: 20px 4px; }
.demo-foot { color: var(--dim); font-size: 12px; text-align: center; padding: 14px 0 4px; }
</style>
