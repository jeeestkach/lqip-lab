<script setup lang="ts">
/**
 * Изображение с трёхступенчатой загрузкой.
 *
 * Ступень 1 — плейсхолдер. Приезжает ВНУТРИ HTML как data URI в атрибуте style.
 *   Ни одного сетевого запроса, рисуется первым пейнтом.
 * Ступень 2 — карточная копия. Обычный <img> с src/srcset, грузится по сети
 *   и накрывает плейсхолдер собой. Подменять ничего не надо: фон и содержимое
 *   элемента это разные слои отрисовки.
 * Ступень 3 — полный размер. Подключается только когда он реально нужен
 *   (открыли карточку), через `fullWidth`.
 *
 * Тег остаётся настоящим <img> с alt и srcset, поэтому индексация не страдает.
 * Фоном здесь работает ТОЛЬКО плейсхолдер, но никогда не сам контент.
 */

interface Variant {
  width: number;
  height: number;
  format: string;
  bytes: number;
  url: string;
}

const props = withDefaults(
  defineProps<{
    /** base64 плейсхолдера с префиксом — как его отдаёт API. */
    placeholder: string;
    variants: Variant[];
    width: number;
    height: number;
    alt: string;
    /** Ширина слота для атрибута sizes. */
    sizes?: string;
    /** Максимальная ширина копии, которую разрешено грузить. Это и есть «ступень». */
    maxWidth?: number;
    /** Приоритетная загрузка — для картинки, которая и есть LCP. */
    priority?: boolean;
    /** Искусственная задержка CDN, мс. Демонстрационный параметр. */
    delay?: number;
  }>(),
  { sizes: '100vw', maxWidth: 640, priority: false, delay: 0 },
);

/** Добавляет к URL демонстрационную задержку, если она задана. */
function withDelay(url: string): string {
  return props.delay > 0 ? `${url}?delay=${props.delay}` : url;
}

/** Копии, не превышающие текущую ступень. */
const usable = computed(() => {
  const fit = props.variants.filter((v) => v.width <= props.maxWidth);
  // Если все копии крупнее лимита, берём самую мелкую — иначе показать нечего.
  return fit.length ? fit : props.variants.slice(0, 1);
});

const srcset = computed(() => usable.value.map((v) => `${withDelay(v.url)} ${v.width}w`).join(', '));
const src = computed(() => withDelay(usable.value[usable.value.length - 1]!.url));

const loaded = ref(false);
const imgEl = ref<HTMLImageElement | null>(null);

/**
 * Включает плавное проявление. Выключено до гидратации намеренно.
 *
 * Анимация прячет картинку (`opacity: 0`) и показывает её по событию `load`.
 * Если включить это на сервере, получим две поломки:
 *   1) без JS изображение останется невидимым навсегда;
 *   2) картинка из кеша успевает выстрелить `load` ДО гидратации, обработчик
 *      уже не сработает — и она тоже останется невидимой.
 * Поэтому по умолчанию картинка видима, а анимация включается только на клиенте
 * и только для тех файлов, что на момент монтирования ещё не пришли.
 */
const fade = ref(false);

onMounted(() => {
  if (imgEl.value?.complete && imgEl.value.naturalWidth > 0) {
    loaded.value = true;
  } else {
    fade.value = true;
  }
});
</script>

<template>
  <div
    class="smart-image"
    :style="{ aspectRatio: `${width} / ${height}`, '--ph': `url(${placeholder})` }"
    :class="{ 'is-loaded': loaded, 'is-fading': fade }"
  >
    <img
      ref="imgEl"
      :src="src"
      :srcset="srcset"
      :sizes="sizes"
      :width="width"
      :height="height"
      :alt="alt"
      :loading="priority ? 'eager' : 'lazy'"
      :fetchpriority="priority ? 'high' : 'auto'"
      decoding="async"
      @load="loaded = true"
    >
  </div>
</template>

<style scoped>
.smart-image {
  display: block;
  position: relative;
  width: 100%;
  overflow: hidden;
  background-color: var(--panel);
}

.smart-image img {
  display: block;
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/**
 * Плейсхолдер отдельным слоем, а не фоном на самом <img>.
 *
 * Фоном на теге он остаётся резко-квадратным: браузер растягивает 20 пикселей
 * билинейной интерполяцией, а она сглаживает только соседние пиксели и на
 * десятикратном увеличении даёт мягкие квадраты, а не размытие. Настоящий блюр
 * даёт filter, но повесить его на <img> нельзя — он размоет и загруженную картинку.
 *
 * Псевдоэлемент решает обе задачи: <img> сохраняет alt, srcset и семантику,
 * а фильтр действует только на плейсхолдер. Пришедший файл рисуется поверх.
 */
.smart-image::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--ph);
  background-size: cover;
  background-position: center;
  filter: blur(12px);
  /* Блюр размывает и края — увеличиваем, чтобы кайма ушла за overflow: hidden. */
  transform: scale(1.15);
}

/* ——— плавная подмена ———
 *
 * Порядок важен. Сначала картинка ПРОЯВЛЯЕТСЯ поверх размытого слоя, и только
 * когда стала полностью непрозрачной, слой гаснет. Если гасить их одновременно,
 * в середине перехода оба полупрозрачны, сквозь них просвечивает фон контейнера
 * и получается вспышка.
 *
 * Гасить слой всё-таки нужно: у картинок с альфа-каналом он иначе просвечивал бы
 * сквозь прозрачные места и после загрузки.
 */
.smart-image.is-fading img {
  opacity: 0;
  transition: opacity .45s ease;
}

.smart-image.is-fading.is-loaded img {
  opacity: 1;
}

.smart-image.is-fading.is-loaded::before {
  opacity: 0;
  transition: opacity .3s ease .45s;
}

@media (prefers-reduced-motion: reduce) {
  .smart-image.is-fading img,
  .smart-image.is-fading.is-loaded::before {
    transition: none;
  }
}
</style>
