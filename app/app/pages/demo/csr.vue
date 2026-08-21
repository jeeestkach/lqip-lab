<script setup lang="ts">
/**
 * Стратегия 1: только клиентский рендер.
 *
 * Сервер отдаёт HTML БЕЗ карточек — пустую оболочку. Дальше по шагам:
 *   1. браузер получает и разбирает HTML, качает и исполняет JS;
 *   2. клиент запрашивает `/api/images`;
 *   3. приходят данные — только теперь появляются карточки;
 *   4. и только потом начинают грузиться изображения.
 *
 * Каждый шаг ждёт предыдущего. Отсюда и берётся пустой экран, знакомый по
 * каталогам на медленном соединении: до третьего шага показывать попросту нечего.
 */

definePageMeta({ layout: false });

const params = useDemoParams();

// `server: false` — запрос уходит ТОЛЬКО из браузера, после гидратации.
// Это и есть клиентская стратегия: сервер о списке товаров ничего не знает.
const { data, status } = await useFetch('/api/images', { server: false, lazy: true });
const cards = computed(() => buildCards(data.value?.images, params));

const loader = useSequentialImages();

function run() {
  loader.start(
    cards.value.map((c) => ({ key: c.key, url: c.url })),
    params.concurrency,
  );
}

// Загрузку картинок начинаем не раньше, чем пришли сами данные —
// иначе стратегия перестала бы быть честной.
watch(cards, (list) => { if (list.length) run(); });

const { post, offset } = useDemoFrame({
  strategy: 'csr',
  onRun: () => { if (cards.value.length) run(); },
  onStop: loader.stop,
});

watch(
  () => [loader.done.value.size, loader.running.value, status.value],
  () => post({
    type: 'demo:progress',
    strategy: 'csr',
    done: loader.done.value.size,
    total: loader.total.value,
    elapsed: loader.elapsed.value,
    bytes: loader.bytes.value,
    fetching: status.value === 'pending',
  }),
);
</script>

<template>
  <div class="demo-viewport">
    <div class="demo-page" :style="{ transform: `translateY(${-offset}px)` }">
    <!--
      Текст намеренно не зависит от статуса запроса: на сервере он ещё 'idle',
      на клиенте сразу 'pending', и разметка бы разошлась при гидратации.
      Пока карточек нет — состояние ровно одно, и описывать его надо одинаково.
    -->
    <p v-if="!cards.length" class="demo-empty">Запрашиваю список товаров…</p>
    <DemoGrid v-else :cards="cards" :loaded="loader.done.value" :with-placeholder="false" />
    </div>
  </div>
</template>

<style scoped>
/*
 * Клип делаем ЛОКАЛЬНО, а не через `html, body { overflow: hidden }`:
 * незакрытый (не scoped) блок стилей утекает в документ родителя и ломает
 * прокрутку самой страницы сравнения. Фиксированная обёртка занимает ровно
 * область кадра и обрезает содержимое, не трогая ничего снаружи.
 *
 * Страница внутри iframe НЕ прокручивается сама: её сдвигает родитель через
 * transform. Собственная полоса была бы вторым источником правды.
 */
.demo-viewport {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
.demo-page { padding: 12px; will-change: transform; }
.demo-empty { color: var(--dim); font-size: 13px; padding: 20px 4px; }
</style>
