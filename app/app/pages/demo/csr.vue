<script setup lang="ts">
/**
 * Стратегия 1: только клиентский рендер.
 *
 * Сервер отдаёт HTML БЕЗ карточек — пустую оболочку. Дальше по шагам:
 *   1. браузер получает и разбирает HTML, качает и исполняет JS;
 *   2. клиент запрашивает `/api/images`;
 *   3. приходят данные — только теперь появляются карточки;
 *   4. и только теперь браузер видит теги `<img>` и начинает качать файлы.
 *
 * Изображения грузятся ОБЫЧНЫМ образом: `src` и `srcset`, параллельно, силами
 * браузера, без очередей и искусственных задержек. Проигрыш этой стратегии —
 * не в скорости самих картинок, а в том, что до третьего шага показывать нечего,
 * и запросы за ними даже не начинаются.
 */

definePageMeta({ layout: false });

useHead({
  title: 'Каталог товаров — клиентский рендер',
  meta: [{ name: 'description', content: 'Каталог: список запрашивается браузером после загрузки скриптов.' }],
});

const params = useDemoParams();

// `server: false` — запрос уходит ТОЛЬКО из браузера, после гидратации.
// Это и есть клиентская стратегия: сервер о списке товаров ничего не знает.
const { data: cards } = await useFetch('/api/images', {
  query: { ph: params.ph },
  server: false,
  lazy: true,
  transform: (d: any) => buildCards(d?.images, params),
});

const { offset, markFirstImagery, markCardsVisible } = useDemoFrame({
  strategy: 'csr',
  onRun: () => undefined,
  onStop: () => undefined,
});

// Вехи снимаются, когда карточки появились в разметке. Обёртка обязательна:
// requestAnimationFrame передаёт колбэку метку времени, и она попала бы
// в первый параметр как `atFirstPaint = true`.
watch(
  () => (cards.value ?? []).length,
  (n) => {
    if (!n) return;
    nextTick(() => requestAnimationFrame(() => { markCardsVisible(); markFirstImagery(); }));
  },
  { immediate: true },
);
</script>

<template>
  <div class="demo-viewport">
    <div class="demo-page" :style="{ transform: `translateY(${-offset}px)` }">
      <!--
        Текст намеренно не зависит от статуса запроса: на сервере он ещё 'idle',
        на клиенте сразу 'pending', и разметка разошлась бы при гидратации.
      -->
      <p v-if="!cards?.length" class="demo-empty">Запрашиваю список товаров…</p>
      <DemoGrid v-else :cards="cards" :with-placeholder="false" />
    </div>
  </div>
</template>

<style scoped>
/*
 * Клип локальный, а не через `html, body { overflow: hidden }`: незакрытый
 * блок стилей утекает в документ родителя и ломает прокрутку страницы сравнения.
 * Страница внутри iframe не прокручивается сама — её сдвигает родитель.
 */
.demo-viewport { position: fixed; inset: 0; overflow: hidden; }
.demo-page { padding: 12px; will-change: transform; }
.demo-empty { color: var(--dim); font-size: 13px; padding: 20px 4px; }
</style>
