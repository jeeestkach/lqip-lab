<script setup lang="ts">
/**
 * Карточка товара — повторяет разметку каталога provybor.com.
 *
 * Состав взят с живой выдачи: изображение 3:4, значок поставщика (логотип
 * или буква, если логотипа нет), название в две строки, цена, минимальная
 * партия и кнопка. Демка должна выглядеть как настоящая витрина, иначе
 * сравнение стратегий рендера ни о чём не говорит.
 */

interface Product {
  href: string;
  supplier: string;
  supplierLogo?: string;
  supplierBadge?: string;
  price: string;
  minQty?: string;
}

const props = defineProps<{
  title: string;
  width: number;
  height: number;
  /** Ключ правила с плейсхолдером в общем блоке стилей — для серверной порции. */
  phKey?: string;
  /**
   * Готовый data URI превью — для порций, догруженных на клиенте.
   *
   * Их правил в серверном блоке стилей нет и быть не может: документ давно
   * отдан. Такие карточки несут превью инлайновым стилем — в разметке документа
   * это ничего не стоит, потому что документ уже у клиента.
   */
  placeholder?: string;
  /** Показывать ли размытое превью до прихода файла. */
  withPlaceholder: boolean;
  /**
   * Единственный адрес изображения.
   *
   * `srcset` карточке не нужен: слот в сетке задан вёрсткой и не меняется,
   * а ширина копии подобрана так, чтобы перекрыть его на ретине. Набор из трёх
   * адресов стоил бы 64-символьного хеша в каждом, на каждой карточке.
   */
  url?: string;
  /** Грузить немедленно (первый экран) или лениво. */
  eager?: boolean;
  product?: Product;
}>();

/** Превью либо инлайном (догруженная порция), либо классом (серверная). */
const phStyle = computed(() =>
  props.placeholder ? { '--ph': `url(${props.placeholder})` } : undefined,
);
const hasPh = computed(() => props.withPlaceholder && Boolean(props.placeholder || props.phKey));

/** Первая буква поставщика — запасной значок, когда логотипа нет. */
const badge = computed(
  () => props.product?.supplierBadge || props.product?.supplier?.[0]?.toUpperCase() || '?',
);

/**
 * Предзагрузка страницы товара при наведении.
 *
 * Наведение опережает клик на сотни миллисекунд — этого хватает, чтобы документ
 * уже ехал к моменту нажатия. Ставим ОДИН раз на карточку: повторные `<link>`
 * с тем же адресом браузер игнорирует, но мусорят в `<head>`.
 *
 * `prefetch`, а не `preload`: приоритет низкий, и если человек не кликнет,
 * запрос не отберёт полосу у изображений, которые видны прямо сейчас.
 */
const prefetched = ref(false);
function prefetchProduct() {
  if (prefetched.value || !props.product?.href || !import.meta.client) return;
  prefetched.value = true;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = props.product.href;
  document.head.appendChild(link);
}
</script>

<template>
  <div class="pcard" @mouseenter="prefetchProduct" @focusin="prefetchProduct">
    <a class="pcard-link" :href="product?.href ?? '#'">
      <!--
        Класс `is-loaded` сюда ставит наблюдатель из head, а не Vue: фотография
        часто успевает загрузиться до того, как выполнится код фреймворка.
      -->
      <div
        class="pcard-media"
        :class="hasPh ? ['has-ph', placeholder ? '' : `ph-${phKey}`] : []"
        :style="phStyle"
      >
        <img
          v-if="url"
          :src="url"
          :alt="title"
          :width="width"
          :height="height"
          :loading="eager ? 'eager' : 'lazy'"
          :fetchpriority="eager ? 'high' : 'auto'"
          decoding="async"
        >
      </div>

      <div class="pcard-supplier">
        <img v-if="product?.supplierLogo" :src="product.supplierLogo" :alt="product.supplier" class="pcard-logo">
        <span v-else class="pcard-badge">{{ badge }}</span>
        <span class="pcard-supplier-name">{{ product?.supplier ?? '—' }}</span>
      </div>

      <div class="pcard-title-wrap">
        <h2 class="pcard-title">{{ title }}</h2>
      </div>

      <div class="pcard-bottom">
        <div class="pcard-price">{{ product?.price ?? '' }}</div>
        <!-- Высота фиксирована, чтобы карточки без минимальной партии
             не ломали сетку: в живом каталоге ровно так же. -->
        <div class="pcard-minqty">{{ product?.minQty ?? '' }}</div>
      </div>
    </a>

    <div class="pcard-action">
      <span class="pcard-btn">Подробнее</span>
    </div>
  </div>
</template>

<style>
/*
 * Блок НЕ scoped: все селекторы и так именованы по БЭМ с приставкой pcard-,
 * а Vue поверх этого дописывал бы data-v-… каждому элементу карточки. На сорока
 * карточках это 629 атрибутов и 10 040 байт разметки. Сжатие почти всё это
 * съедает (по проводу цена около 112 байт), но байты есть байты, а приставка
 * защищает от пересечений не хуже.
 */
.pcard {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  transition: border-color .15s;
}
.pcard:hover { border-color: color-mix(in oklab, var(--accent) 45%, var(--line)); }

.pcard-link { display: flex; flex-direction: column; flex: 1; text-decoration: none; color: inherit; }

/* Пропорция 3:4 как в каталоге; место резервируется сразу, сдвига не будет. */
.pcard-media {
  position: relative;
  aspect-ratio: 3 / 4;
  width: 100%;
  overflow: hidden;
  border-radius: 14px 14px 0 0;
  background: var(--bg);
}
.pcard-media img {
  display: block; width: 100%; height: 100%; object-fit: cover;
  position: relative; z-index: 1;
}

.pcard-supplier { display: flex; align-items: center; gap: 6px; padding: 8px 8px 0; }
.pcard-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
.pcard-badge {
  display: flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
  font-size: 9px; font-weight: 600;
  background: color-mix(in oklab, var(--rec) 22%, transparent);
  color: var(--rec);
}
.pcard-supplier-name {
  font-size: 11px; color: var(--dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.pcard-title-wrap { padding: 4px 8px 6px; }
.pcard-title {
  margin: 0; font-size: 13px; font-weight: 600; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
  min-height: 2.6em;
}

.pcard-bottom { margin-top: auto; padding: 0 8px 8px; }
.pcard-price { font-size: 15px; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
.pcard-minqty { height: 16px; font-size: 11px; color: var(--dim); }

.pcard-action { padding: 0 8px 8px; }
.pcard-btn {
  display: block; text-align: center; padding: 6px 10px;
  border-radius: 7px; font-size: 13px; font-weight: 600;
  background: var(--accent); color: #fff;
}

/**
 * Плейсхолдер отдельным слоем, а не фоном на самом <img>.
 * Фоном он остаётся резко-квадратным: браузер растягивает 20 пикселей
 * билинейной интерполяцией и даёт мягкие квадраты, а не размытие. Настоящий
 * блюр даёт filter, но на <img> его вешать нельзя — размоет и картинку.
 */
.pcard-media.has-ph::before {
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
/*
 * Проявление живёт в глобальных стилях (assets/app.css), а не здесь.
 *
 * Оно завязано на класс `reveal` у корня документа, а `:global(html.reveal) …`
 * в scoped-блоке собирается неправильно: Vue отбрасывает потомков и оставляет
 * правило на самом `html`. Проверено — вместо проявления получался переход
 * прозрачности на всей странице.
 */
</style>
