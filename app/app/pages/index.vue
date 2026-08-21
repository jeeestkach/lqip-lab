<script setup lang="ts">
/**
 * Каталог товаров — ступени 1 и 2.
 *
 * Данные берутся на СЕРВЕРЕ (useFetch при SSR), поэтому плейсхолдеры попадают
 * прямо в HTML. Открыв исходный код страницы, их видно в атрибутах style —
 * это и есть главное свойство схемы: до первого сетевого запроса за картинками
 * пользователь уже видит раскладку и цвета.
 */

/** Задержка отдачи файлов, мс. Живёт в адресе — см. composables/useQueryParam.ts. */
const delay = useQueryParam('delay', 0);

const { data, refresh } = await useFetch('/api/images');

useHead({ title: 'Каталог — демка загрузки изображений' });

/** Суммарный вес плейсхолдеров в документе — цена, которую платим за ступень 1. */
const placeholderWeight = computed(() => {
  const images = data.value?.images ?? [];
  return images.reduce((sum, img) => sum + img.placeholder.length, 0);
});

const fmt = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);
</script>

<template>
  <div class="wrap">
    <h1>Каталог</h1>
    <p class="dim">
      Ступень 1 — плейсхолдер уже в HTML, ноль запросов. Ступень 2 — карточная копия 300 px по сети.
      Полный размер здесь не грузится вовсе: он нужен только на странице товара.
    </p>

    <div class="controls">
      <label>
        задержка CDN
        <select v-model.number="delay">
          <option :value="0">нет</option>
          <option :value="600">0,6 с</option>
          <option :value="2000">2 с</option>
          <option :value="8000">8 с</option>
        </select>
      </label>
      <span class="dim" style="font-size:13px">
        притормаживает отдачу файлов. Чтобы увидеть настоящий первый пейнт,
        перезагрузите страницу (⌘R) — задержка уже в адресе
      </span>
      <button class="ghost" @click="refresh()">Обновить данные</button>
    </div>

    <div v-if="data?.images?.length" class="stat-row">
      <span>изображений <b>{{ data.count }}</b></span>
      <span>плейсхолдеров в HTML <b>{{ fmt(placeholderWeight) }}</b></span>
      <span>это цена ступени 1 на всю страницу</span>
    </div>

    <p v-if="!data?.images?.length" class="dim" style="margin-top:24px">
      Пока пусто. <NuxtLink to="/upload">Загрузите изображения</NuxtLink>, чтобы увидеть, как это работает.
    </p>

    <div v-else class="grid">
      <NuxtLink v-for="img in data.images" :key="img.id" :to="`/product/${img.id}`" class="card">
        <SmartImage
          :placeholder="img.placeholder"
          :variants="img.variants"
          :width="img.width"
          :height="img.height"
          :alt="img.title"
          :max-width="300"
          :delay="delay"
          sizes="(max-width: 700px) 50vw, 240px"
        />
        <div class="card-body">
          <div class="card-title">{{ img.title }}</div>
          <div class="card-meta">{{ img.width }}×{{ img.height }} · {{ fmt(img.original.bytes) }}</div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
