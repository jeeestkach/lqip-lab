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

onMounted(() => {
  window.addEventListener('message', (e) => {
    if (e.data === 'demo:run') {
      if (cards.value.length) run();
    }
    if (e.data === 'demo:stop') loader.stop();
  });
  window.parent?.postMessage({ type: 'demo:ready', strategy: 'csr' }, '*');
});

watch(
  () => [loader.done.value.size, loader.running.value, status.value],
  () => {
    window.parent?.postMessage(
      {
        type: 'demo:progress',
        strategy: 'csr',
        done: loader.done.value.size,
        total: loader.total.value,
        elapsed: loader.elapsed.value,
        bytes: loader.bytes.value,
        fetching: status.value === 'pending',
      },
      '*',
    );
  },
);
</script>

<template>
  <div class="demo-page">
    <p v-if="!cards.length" class="demo-empty">
      {{ status === 'pending' ? 'Запрашиваю список товаров…' : 'Список пуст' }}
    </p>
    <DemoGrid v-else :cards="cards" :loaded="loader.done.value" :with-placeholder="false" />
  </div>
</template>

<style>
.demo-page { padding: 12px; }
.demo-empty { color: var(--dim); font-size: 13px; padding: 20px 4px; }
body { margin: 0; }
</style>
