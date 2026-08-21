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
  placeholder: string;
  price: number;
}

defineProps<{
  cards: Card[];
  /** Готовые изображения по ключу карточки. */
  loaded: Map<string, { objectUrl: string; bytes: number; ms: number }>;
  /** Показывать ли размытый плейсхолдер до прихода файла. */
  withPlaceholder: boolean;
}>();
</script>

<template>
  <div class="dgrid">
    <article v-for="card in cards" :key="card.key" class="dcard">
      <div
        class="dcard-media"
        :class="{ 'has-ph': withPlaceholder, 'is-loaded': loaded.has(card.key) }"
        :style="{
          aspectRatio: `${card.width} / ${card.height}`,
          ...(withPlaceholder ? { '--ph': `url(${card.placeholder})` } : {}),
        }"
      >
        <img
          v-if="loaded.has(card.key)"
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
