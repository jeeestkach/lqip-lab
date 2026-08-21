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

// Мета-теги у обеих стратегий одинаковые: разница НЕ в них, а в содержимом.
useHead({
  title: 'Каталог товаров — SSR',
  meta: [{ name: 'description', content: 'Каталог товаров: карточки, цены и размытые превью приходят готовыми в HTML.' }],
});

const params = useDemoParams();
const route = useRoute();

/**
 * Режим загрузки изображений. Только для серверной стратегии — клиентская
 * не меняется, иначе сравнивать было бы нечего.
 */
const mode = computed<'queue' | 'lazy' | 'eager' | 'auto'>(() => {
  const m = String(route.query.load ?? 'auto');
  return m === 'lazy' || m === 'eager' || m === 'queue' ? m : 'auto';
});

// Ключевое отличие от клиентской стратегии: данные берутся НА СЕРВЕРЕ,
// поэтому карточки и плейсхолдеры попадают в HTML.
// `transform` выполняется НА СЕРВЕРЕ, и в payload гидратации уезжает уже
// результат, а не сырой ответ API. Без него Nuxt клал бы в документ всё,
// что вернул эндпоинт: все четыре ширины плейсхолдера вместо одной нужной,
// все варианты размеров, тайминги обработки. Замер показал, что на этом
// уходило 23 КБ из 39 КБ payload — три четверти впустую.
/**
 * Блок стилей с плейсхолдерами. Собирается на сервере и НЕ попадает в payload.
 *
 * Плейсхолдеры нужны только для отрисовки: размытие рисует CSS, и клиенту
 * после гидратации сами строки не нужны ни для чего. Замер показал, что в
 * payload они занимали 3,9 КБ мёртвым грузом.
 */
let placeholderCss = '';

const { data: cards } = await useFetch('/api/images', {
  query: { ph: params.ph },
  transform: (d: any) => {
    const built = buildCards(d?.images, params);
    // Собираем стили ДО того, как выбросить плейсхолдеры из данных.
    if (import.meta.server) placeholderCss = buildPlaceholderCss(built);
    // Клиенту уезжают карточки БЕЗ плейсхолдеров — только ключ правила.
    return built.map(({ placeholder, ...rest }: any) => rest);
  },
});

/*
 * `useServerHead`, а не `useHead`: серверный вариант не переносит содержимое
 * в payload и не пытается применить его повторно на клиенте. Ровно то, что
 * нужно — стили должны приехать в документе и там остаться.
 */
if (placeholderCss) {
  useServerHead({ style: [{ innerHTML: placeholderCss }] });
}

const loader = useSequentialImages();

/** Начинает прогон заново. Вызывается и снаружи — со страницы сравнения. */
function run() {
  // В нативных режимах очередь не нужна: ссылки уже в разметке, грузит браузер.
  if (mode.value !== 'queue') return;
  loader.start(
    (cards.value ?? []).map((c) => ({ key: c.key, url: c.url })),
    params.concurrency,
  );
}

/** Считает загруженные в нативных режимах — для той же статистики наверх. */
const nativeDone = ref(0);
function onImageLoaded() {
  nativeDone.value += 1;
  if (nativeDone.value === 1) markFirstPhoto();
  post({
    type: 'demo:progress',
    strategy: 'ssr',
    done: nativeDone.value,
    total: (cards.value ?? []).length,
    elapsed: Math.round(performance.now()),
    bytes: 0,
  });
}

// Родитель дирижирует прогоном обоих кадров и держит их прокрутку согласованной.
const { post, offset, markFirstImagery, markCardsVisible, markFirstPhoto } = useDemoFrame({ strategy: 'ssr', onRun: run, onStop: loader.stop });

onMounted(run);

// Веха «товар виден» — на следующем кадре отрисовки после появления карточек.
watch(
  () => (cards.value ?? []).length,
  (n) => {
    if (!n) return;
    // И карточки, и плейсхолдеры лежат в серверном HTML: они нарисованы
    // вместе с первым пейнтом, ЗАДОЛГО до гидратации. Отмечать их моментом
    // гидратации значило бы приписать стратегии чужое время — загрузку
    // и разбор скриптов, к показу отношения не имеющие.
    nextTick(() => requestAnimationFrame(() => {
      markCardsVisible(true);
      markFirstImagery(true);
    }));
  },
  { immediate: true },
);

// В режиме очереди фотография приходит через загрузчик.
watch(() => loader.done.value.size, (n) => { if (n) markFirstPhoto(); });

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
    <DemoGrid
      :cards="cards ?? []"
      :loaded="loader.done.value"
      :with-placeholder="true"
      :mode="mode"
      @image-loaded="onImageLoaded"
    />
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
