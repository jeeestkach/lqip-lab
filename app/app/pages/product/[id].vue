<script setup lang="ts">
/**
 * Карточка товара — ступень 3.
 *
 * Здесь и только здесь подключается полноразмерная копия. Пока она едет,
 * видна ступень 2 (та же карточная копия, что уже лежит в кеше браузера
 * после каталога), а под ней — плейсхолдер из HTML.
 */

const route = useRoute();

/** Задержка отдачи файлов, мс. */
const delay = useQueryParam('delay', 0);

const full = ref(false);

const { data: img } = await useFetch(`/api/images/${route.params.id}`, { query: { ph: '20' } });
if (!img.value) throw createError({ statusCode: 404, statusMessage: 'Изображение не найдено' });

useHead({ title: `${img.value.title} — демка загрузки изображений` });

const fmt = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);

/** Ширина, до которой разрешено грузить: ступень 2 или ступень 3. */
const maxWidth = computed(() => (full.value ? 99999 : 300));

/** Самая крупная доступная копия — её вес показываем как цену ступени 3. */
const largest = computed(() => img.value!.variants[img.value!.variants.length - 1]!);
</script>

<template>
  <div v-if="img" class="wrap">
    <p style="margin-bottom:18px"><NuxtLink to="/">← к каталогу</NuxtLink></p>
    <h1>{{ img.title }}</h1>

    <div class="controls">
      <button :disabled="full" @click="full = true">
        {{ full ? 'Полный размер загружен' : `Загрузить полный размер (${largest.width} px, ${fmt(largest.bytes)})` }}
      </button>
      <button v-if="full" class="ghost" @click="full = false">Сбросить к ступени 2</button>
      <label>
        задержка CDN
        <select v-model.number="delay">
          <option :value="0">нет</option>
          <option :value="600">0,6 с</option>
          <option :value="2000">2 с</option>
          <option :value="8000">8 с</option>
        </select>
      </label>
    </div>

    <div class="product">
      <SmartImage
        :placeholder="img.placeholder"
        :variants="img.variants"
        :width="img.width"
        :height="img.height"
        :alt="img.title"
        :max-width="maxWidth"
        :delay="delay"
        priority
        sizes="(max-width: 760px) 100vw, 560px"
      />

      <div>
        <h2 style="margin-top:0">Что сейчас показано</h2>
        <p class="dim">
          {{ full
            ? 'Ступень 3: полный размер. До его прихода была видна карточная копия — и ни одного пустого места.'
            : 'Ступень 2: карточная копия 300 px. Она уже в кеше после каталога, поэтому появилась мгновенно.' }}
        </p>

        <dl class="product-meta">
          <dt>Плейсхолдер в HTML</dt>
          <dd>{{ fmt(img.placeholder.length) }} · ноль запросов</dd>

          <dt>Оригинал</dt>
          <dd>{{ img.width }}×{{ img.height }} · {{ fmt(img.original.bytes) }}</dd>

          <dt>Копии в хранилище</dt>
          <dd>
            <div v-for="v in img.variants" :key="v.width">
              {{ v.width }}×{{ v.height }} {{ v.format }} — {{ fmt(v.bytes) }}
            </div>
          </dd>

          <dt>Обработка при загрузке</dt>
          <dd>
            <div v-for="(ms, step) in img.timings" :key="step">{{ step }}: {{ ms }} мс</div>
          </dd>
        </dl>

        <h2>Что приехало в HTML</h2>
        <p class="dim">Ровно эта строка лежит в атрибуте style — никакого JS для её показа не нужно.</p>
        <pre><code>{{ img.placeholder.slice(0, 120) }}…</code></pre>
      </div>
    </div>
  </div>
</template>
