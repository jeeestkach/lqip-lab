<script setup lang="ts">
/**
 * Стратегия 2: серверный рендер с обогащением.
 *
 * Сервер отдаёт готовый HTML, в котором УЖЕ есть карточки, размеры и размытые
 * плейсхолдеры. Клиенту не нужно ничего запрашивать, чтобы показать раскладку:
 * первый пейнт — это сразу страница целиком, только картинки ещё размыты.
 *
 * Дальше клиент загружает файлы по очереди — слева направо, сверху вниз —
 * и снимает блюр с каждой карточки по мере готовности.
 */

definePageMeta({ layout: false });

const params = useDemoParams();

// Ключевое отличие от клиентской стратегии: данные берутся НА СЕРВЕРЕ,
// поэтому карточки и плейсхолдеры попадают в HTML.
const { data } = await useFetch('/api/images');
const cards = computed(() => buildCards(data.value?.images, params));

const loader = useSequentialImages();

/** Начинает прогон заново. Вызывается и снаружи — со страницы сравнения. */
function run() {
  loader.start(
    cards.value.map((c) => ({ key: c.key, url: c.url })),
    params.concurrency,
  );
}

onMounted(() => {
  // Родитель может дирижировать прогоном обоих кадров одновременно.
  window.addEventListener('message', (e) => {
    if (e.data === 'demo:run') run();
    if (e.data === 'demo:stop') loader.stop();
  });
  window.parent?.postMessage({ type: 'demo:ready', strategy: 'ssr' }, '*');
  run();
});

watch(
  () => [loader.done.value.size, loader.running.value],
  () => {
    window.parent?.postMessage(
      {
        type: 'demo:progress',
        strategy: 'ssr',
        done: loader.done.value.size,
        total: loader.total.value,
        elapsed: loader.elapsed.value,
        bytes: loader.bytes.value,
      },
      '*',
    );
  },
);
</script>

<template>
  <div class="demo-page">
    <DemoGrid :cards="cards" :loaded="loader.done.value" :with-placeholder="true" />
  </div>
</template>

<style>
/* Страница живёт внутри iframe — свои отступы держим минимальными. */
.demo-page { padding: 12px; }
body { margin: 0; }
</style>
