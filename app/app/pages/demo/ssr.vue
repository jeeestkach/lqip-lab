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

// Родитель дирижирует прогоном обоих кадров и держит их прокрутку согласованной.
const { post, offset } = useDemoFrame({ strategy: 'ssr', onRun: run, onStop: loader.stop });

onMounted(run);

watch(
  () => [loader.done.value.size, loader.running.value],
  () => post({
    type: 'demo:progress',
    strategy: 'ssr',
    done: loader.done.value.size,
    total: loader.total.value,
    elapsed: loader.elapsed.value,
    bytes: loader.bytes.value,
  }),
);
</script>

<template>
  <div class="demo-viewport">
    <div class="demo-page" :style="{ transform: `translateY(${-offset}px)` }">
    <DemoGrid :cards="cards" :loaded="loader.done.value" :with-placeholder="true" />
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
</style>
