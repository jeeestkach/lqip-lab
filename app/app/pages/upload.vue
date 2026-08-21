<script setup lang="ts">
/**
 * Загрузка изображений. Файлы уходят на сервер как есть, в высоком качестве;
 * весь ресайз и сжатие делает сервер — браузерный кодировщик втрое хуже,
 * это замерено (см. исследовательскую страницу проекта).
 */

useHead({ title: 'Загрузка — демка загрузки изображений' });

const sizes = ref('300,640,1280');
const busy = ref(false);
const error = ref('');
const result = ref<{ count: number; images: any[] } | null>(null);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const fmt = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);

/** Отправляет выбранные файлы на сервер одним запросом. */
async function send(files: FileList | File[]) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;

  busy.value = true;
  error.value = '';
  result.value = null;

  const body = new FormData();
  for (const f of list) body.append('file', f);

  try {
    result.value = await $fetch(`/api/images?sizes=${encodeURIComponent(sizes.value)}`, {
      method: 'POST',
      body,
    });
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? err?.message ?? 'не удалось загрузить';
  } finally {
    busy.value = false;
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  if (e.dataTransfer?.files) send(e.dataTransfer.files);
}
</script>

<template>
  <div class="wrap">
    <h1>Загрузка</h1>
    <p class="dim">
      Отдаём файл в высоком качестве. Сервер режет запрошенные размеры из оригинала,
      затем из самой мелкой копии делает плейсхолдер 20 px и кодирует в base64.
      В ответе — ссылки на CDN под каждый размер и готовый плейсхолдер с префиксом.
    </p>

    <div class="controls">
      <label>
        размеры, px
        <input v-model="sizes" type="text" size="16" placeholder="300,640,1280">
      </label>
      <span class="dim" style="font-size:13px">через запятую; больше оригинала — отбрасываются</span>
    </div>

    <div
      class="dropzone"
      :class="{ drag: dragging }"
      @click="fileInput?.click()"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <b>{{ busy ? 'Обрабатываю…' : 'Перетащите изображения сюда' }}</b>
      <span class="dim" style="font-size:13px">или нажмите, чтобы выбрать · можно несколько сразу</span>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        hidden
        @change="send(($event.target as HTMLInputElement).files!)"
      >
    </div>

    <p v-if="error" style="color:#dc2626;margin-top:16px">Ошибка: {{ error }}</p>

    <template v-if="result">
      <h2>Готово: {{ result.count }}</h2>
      <p class="dim">
        Это в точности то, что вернул API. Дубликаты определяются по sha256 содержимого —
        повторная загрузка того же файла не создаёт новую запись.
      </p>

      <table>
        <thead>
          <tr><th>Файл</th><th>Плейсхолдер</th><th>Копии</th><th>Обработка</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="img in result.images" :key="img.id">
            <td>
              {{ img.title }}<br>
              <span class="dim">{{ img.width }}×{{ img.height }} · {{ fmt(img.original.bytes) }}</span>
              <span v-if="img.deduplicated" class="dim"><br>уже был загружен</span>
            </td>
            <td class="num">{{ fmt(img.placeholder.length) }}</td>
            <td class="num">
              <div v-for="v in img.variants" :key="v.width">{{ v.width }}px — {{ fmt(v.bytes) }}</div>
            </td>
            <td class="num">
              <div v-for="(ms, step) in img.timings" :key="step">{{ step }}: {{ ms }} мс</div>
            </td>
            <td><NuxtLink :to="`/product/${img.id}`">карточка →</NuxtLink></td>
          </tr>
        </tbody>
      </table>

      <h2>Ответ API</h2>
      <pre><code>{{ JSON.stringify(result.images[0], null, 2) }}</code></pre>
    </template>
  </div>
</template>
