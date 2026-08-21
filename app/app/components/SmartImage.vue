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
</script>

<template>
  <img
    :src="src"
    :srcset="srcset"
    :sizes="sizes"
    :width="width"
    :height="height"
    :alt="alt"
    :loading="priority ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : 'auto'"
    decoding="async"
    class="smart-image"
    :class="{ 'is-loaded': loaded }"
    :style="{
      backgroundImage: `url(${placeholder})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      aspectRatio: `${width} / ${height}`,
    }"
    @load="loaded = true"
  >
</template>

<style scoped>
.smart-image {
  display: block;
  width: 100%;
  height: auto;
  object-fit: cover;
  /* Плейсхолдер — это 20 пикселей, растянутые на всю ширину. Браузер сглаживает
     их при увеличении, и размытие получается само; фильтр лишь прячет края. */
  background-color: var(--panel);
}
</style>
