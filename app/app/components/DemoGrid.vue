<script setup lang="ts">
/**
 * Сетка карточек товара — общая для обеих стратегий рендера.
 *
 * Разница между стратегиями НЕ здесь, а в том, откуда пришли данные: при
 * серверном рендере разметка уже в HTML, при клиентском её ещё предстоит
 * построить после ответа API. Сетка одинакова, иначе сравнение было бы нечестным.
 *
 * Изображения обе стратегии грузят ОДИНАКОВО — обычными тегами `<img>` с `src`
 * и `srcset`, которые качает сам браузер параллельно. Никакой очереди на JS:
 * она вносила искусственную задержку и мешала предсканеру, который начинает
 * качать ещё при разборе HTML.
 */

import type { DemoCard } from '../composables/useDemoCards';

const props = withDefaults(
  defineProps<{
    cards: DemoCard[];
    /** Показывать ли размытый плейсхолдер до прихода файла. */
    withPlaceholder: boolean;
    /** Сколько первых карточек грузить немедленно; остальные — лениво. */
    eagerCount?: number;
  }>(),
  { eagerCount: 6 },
);

/**
 * Грузить ли карточку немедленно.
 *
 * `loading="lazy"` на первом экране вредит: он откладывает запрос до вычисления
 * раскладки, а это уже после разбора документа. Замер показал 2065 мс против
 * 615 мс. Поэтому верх всегда `eager` с высоким приоритетом.
 */
function isEager(index: number): boolean {
  return index < props.eagerCount;
}
</script>

<template>
  <div class="dgrid">
    <ProductCard
      v-for="card in cards"
      :key="card.key"
      :title="card.title"
      :width="card.width"
      :height="card.height"
      :ph-key="card.phKey"
      :placeholder="card.placeholder"
      :with-placeholder="withPlaceholder"
      :url="card.url"
      :eager="isEager(card.index)"
      :product="card.product"
    />
  </div>
</template>

<style scoped>
.dgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

@media (max-width: 620px) {
  .dgrid { grid-template-columns: repeat(2, 1fr); }
}
</style>
