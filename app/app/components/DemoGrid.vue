<script setup lang="ts">
/**
 * Сетка карточек товара — общая для обеих стратегий рендера.
 *
 * Разница между стратегиями не здесь, а в том, ОТКУДА пришли данные:
 * при SSR они уже в HTML вместе с плейсхолдерами, при клиентском рендере
 * их ещё нужно запросить. Сама сетка одинакова, иначе сравнение было бы нечестным.
 */

interface Card {
  id: string;
  key: string;
  index: number;
  title: string;
  width: number;
  height: number;
  /** Ключ правила с плейсхолдером в общем блоке стилей. */
  phKey: string;
  price: number;
  /** Ссылка на карточную копию — для нативной загрузки. */
  url?: string;
  /** Набор размеров — для нативной загрузки. */
  srcset?: string;
}

/**
 * Как грузятся изображения.
 *
 * `queue`  — ссылки подставляет JS по очереди. Полный контроль порядка,
 *            но в разметке нет ни одного тега `<img>`: для поиска по картинкам
 *            страница пуста.
 * `lazy`   — настоящий `src` и `srcset` прямо в серверной разметке,
 *            `loading="lazy"`. Браузер сам решает, что и когда грузить.
 * `eager`  — то же, но `loading="eager"`: всё начинает грузиться сразу,
 *            включая карточки далеко за экраном.
 * `auto`   — первый экран `eager` с высоким приоритетом, остальное `lazy`.
 *            Рекомендуемый вариант: верх начинает грузиться предсканером
 *            ещё при разборе HTML, а низ не отбирает у него полосу.
 */
export type LoadMode = 'queue' | 'lazy' | 'eager' | 'auto';

const props = defineProps<{
  cards: Card[];
  /** Готовые изображения по ключу карточки. Используется только в режиме `queue`. */
  loaded: Map<string, { objectUrl: string; bytes: number; ms: number }>;
  /** Показывать ли размытый плейсхолдер до прихода файла. */
  withPlaceholder: boolean;
  mode?: LoadMode;
}>();

const emit = defineEmits<{ imageLoaded: [key: string] }>();

const mode = computed<LoadMode>(() => props.mode ?? 'queue');
const isNative = computed(() => mode.value !== 'queue');

/** Карточки, чьи изображения браузер уже загрузил (для нативных режимов). */
const nativeLoaded = ref(new Set<string>());

function onNativeLoad(key: string) {
  nativeLoaded.value = new Set(nativeLoaded.value).add(key);
  emit('imageLoaded', key);
}

/** Сколько первых карточек считаем «первым экраном». */
const ABOVE_FOLD = 6;

/**
 * Грузить ли эту карточку немедленно.
 *
 * `loading="lazy"` откладывает запрос до вычисления раскладки, а это уже после
 * разбора документа — замер показал 2065 мс против 615 мс. Поэтому первому
 * экрану ленивость строго противопоказана: его должен подхватить предсканер,
 * который читает `src` прямо из разметки, ещё не дойдя до конца HTML.
 */
function eagerFor(index: number): boolean {
  if (mode.value === 'eager') return true;
  if (mode.value === 'auto') return index < ABOVE_FOLD;
  return false;
}

/** Загружено ли изображение этой карточки — в любом из режимов. */
function isLoaded(key: string): boolean {
  return isNative.value ? nativeLoaded.value.has(key) : props.loaded.has(key);
}
</script>

<template>
  <div class="dgrid">
    <article v-for="card in cards" :key="card.key" class="dcard">
      <!--
        Плейсхолдер подключается КЛАССОМ, а не инлайновым стилем.
        Инлайн повторял бы один и тот же data URI в каждой карточке: при 14
        уникальных изображениях и 42 карточках это 8 КБ чистой переплаты
        за повтор. Класс ссылается на одно правило в общем блоке стилей.
      -->
      <div
        class="dcard-media"
        :class="[
          withPlaceholder ? ['has-ph', `ph-${card.phKey}`] : [],
          { 'is-loaded': isLoaded(card.key) },
        ]"
        :style="{ aspectRatio: `${card.width} / ${card.height}` }"
      >
        <!--
          В нативных режимах тег с настоящим `src` рендерит СЕРВЕР. Это и даёт
          то, чего не даёт `data-src`: поиск по картинкам индексирует только
          настоящий `src` или `srcset`, а `data-src` для него пустое место.
        -->
        <img
          v-if="isNative"
          :src="card.url"
          :srcset="card.srcset"
          sizes="(max-width: 620px) 50vw, 240px"
          :alt="card.title"
          :width="card.width"
          :height="card.height"
          :loading="eagerFor(card.index) ? 'eager' : 'lazy'"
          :fetchpriority="eagerFor(card.index) ? 'high' : 'auto'"
          decoding="async"
          @load="onNativeLoad(card.key)"
        >
        <img
          v-else-if="loaded.has(card.key)"
          :src="loaded.get(card.key)!.objectUrl"
          :alt="card.title"
          :width="card.width"
          :height="card.height"
          decoding="async"
        >
      </div>
      <div class="dcard-body">
        <div class="dcard-title">{{ card.title }}</div>
        <div class="dcard-price">{{ card.price }} ₽</div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.dgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

.dcard { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--panel); }
.dcard-media { position: relative; overflow: hidden; background: var(--bg); }
.dcard-media img {
  display: block; width: 100%; height: 100%; object-fit: cover;
  position: relative; z-index: 1;
  animation: appear .4s ease both;
}
.dcard-body { padding: 8px 10px 10px; }
.dcard-title { font-size: 12px; line-height: 1.3; height: 2.6em; overflow: hidden; }
.dcard-price { font-size: 13px; font-weight: 700; margin-top: 4px;
  font-family: ui-monospace, Menlo, monospace; }

/**
 * Плейсхолдер отдельным слоем, а не фоном на самом <img>.
 * Фоном на теге он остаётся резко-квадратным: браузер растягивает 20 пикселей
 * билинейной интерполяцией, а она даёт мягкие квадраты, а не размытие.
 * Настоящий блюр даёт filter, но на <img> его вешать нельзя — размоет
 * и загруженную картинку.
 */
.dcard-media.has-ph::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--ph);
  background-size: cover;
  background-position: center;
  filter: blur(10px);
  /* Блюр размывает и края — увеличиваем, чтобы кайма ушла за overflow: hidden. */
  transform: scale(1.15);
}

/* Картинка проявляется поверх слоя, и только став непрозрачной — слой гаснет.
   Одновременное гашение дало бы вспышку: в середине оба полупрозрачны. */
.dcard-media.has-ph.is-loaded::before {
  opacity: 0;
  transition: opacity .3s ease .4s;
}

@keyframes appear { from { opacity: 0 } to { opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  .dcard-media img { animation: none; }
  .dcard-media.has-ph.is-loaded::before { transition: none; }
}

@media (max-width: 620px) {
  .dgrid { grid-template-columns: repeat(2, 1fr); }
}
</style>
