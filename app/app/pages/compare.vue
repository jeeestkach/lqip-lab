<script setup lang="ts">
/**
 * Сравнение двух стратегий рендера — двумя НАСТОЯЩИМИ загрузками страницы.
 *
 * Слева и справа — не два блока одной страницы, а два независимых документа
 * в iframe: `/demo/csr` и `/demo/ssr`. Это принципиально: клиентская стратегия
 * должна честно пройти весь свой путь — получить пустой HTML, скачать и
 * исполнить JS, сходить за данными и только потом отрисовать карточки.
 * Внутри одной страницы это не воспроизвести, там данные уже есть.
 *
 * Кнопка перезапускает оба кадра одновременно, перезагружая их адреса,
 * поэтому оба стартуют с первой миллисекунды и в равных условиях.
 */

import { SPEEDS } from '~~/shared/speeds';

useHead({ title: 'Сравнение стратегий рендера' });

const speed = useQueryParam('speed', 'slow4g');
const ph = useQueryParam('ph', '20');
const repeat = useQueryParam('repeat', 3);
const concurrency = useQueryParam('concurrency', 1);

/** Счётчик перезапусков: меняясь, он пересоздаёт оба iframe. */
const runId = ref(0);

const query = computed(
  () => `speed=${speed.value}&ph=${ph.value}&repeat=${repeat.value}&concurrency=${concurrency.value}&r=${runId.value}`,
);

/** Живая статистика каждого кадра. */
const stats = reactive<Record<string, { done: number; total: number; elapsed: number; bytes: number; fetching?: boolean }>>({
  csr: { done: 0, total: 0, elapsed: 0, bytes: 0 },
  ssr: { done: 0, total: 0, elapsed: 0, bytes: 0 },
});

function onMessage(e: MessageEvent) {
  const d = e.data;
  if (d?.type === 'demo:progress' && d.strategy in stats) {
    stats[d.strategy] = {
      done: d.done, total: d.total, elapsed: d.elapsed, bytes: d.bytes, fetching: d.fetching,
    };
  }
}

onMounted(() => window.addEventListener('message', onMessage));
onBeforeUnmount(() => window.removeEventListener('message', onMessage));

/** Перезапускает оба кадра: пересоздание iframe = настоящая новая загрузка. */
function restart() {
  stats.csr = { done: 0, total: 0, elapsed: 0, bytes: 0 };
  stats.ssr = { done: 0, total: 0, elapsed: 0, bytes: 0 };
  runId.value += 1;
}

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} с` : `${ms} мс`);
</script>

<template>
  <div class="cmp">
    <div class="cmp-bar">
      <div class="cmp-row">
        <button @click="restart()">С начала</button>

        <label>
          скорость
          <select v-model="speed">
            <option v-for="s in SPEEDS" :key="s.key" :value="s.key">{{ s.label }} — {{ s.hint }}</option>
          </select>
        </label>

        <label>
          плейсхолдер
          <select v-model="ph">
            <option value="12">12 px</option>
            <option value="20">20 px</option>
            <option value="32">32 px</option>
            <option value="50">50 px</option>
          </select>
        </label>

        <label>
          порядок
          <select v-model.number="concurrency">
            <option :value="1">строго по очереди</option>
            <option :value="3">по 3 сразу</option>
            <option :value="6">по 6 — как браузер</option>
          </select>
        </label>

        <label>
          карточек
          <select v-model.number="repeat">
            <option :value="1">14</option>
            <option :value="3">42</option>
            <option :value="6">84</option>
          </select>
        </label>

        <span class="dim hint">параметры применяются кнопкой «С начала»</span>
      </div>
    </div>

    <div class="ab">
      <section class="pane">
        <header class="pane-head pane-bad">
          <b>Только клиентский рендер</b>
          <span class="pane-stat">
            <template v-if="stats.csr.fetching">запрашивает список…</template>
            <template v-else-if="stats.csr.total">
              {{ stats.csr.done }} / {{ stats.csr.total }} · {{ fmtMs(stats.csr.elapsed) }} · {{ fmt(stats.csr.bytes) }}
            </template>
            <template v-else>ждёт JS</template>
          </span>
        </header>
        <iframe :key="`csr-${runId}`" :src="`/demo/csr?${query}`" title="Клиентский рендер" />
      </section>

      <section class="pane">
        <header class="pane-head pane-good">
          <b>SSR с плейсхолдерами</b>
          <span class="pane-stat">
            <template v-if="stats.ssr.total">
              {{ stats.ssr.done }} / {{ stats.ssr.total }} · {{ fmtMs(stats.ssr.elapsed) }} · {{ fmt(stats.ssr.bytes) }}
            </template>
            <template v-else>готов</template>
          </span>
        </header>
        <iframe :key="`ssr-${runId}`" :src="`/demo/ssr?${query}`" title="SSR с плейсхолдерами" />
      </section>
    </div>

    <div class="cmp-notes">
      <div class="note">
        <b>Это два разных документа, а не два блока одной страницы.</b>
        Слева браузер получает пустую оболочку, качает и исполняет JS, запрашивает
        <code>/api/images</code> и только потом рисует карточки. Справа карточки,
        размеры и размытые плейсхолдеры приезжают уже в HTML — показывать есть что
        с первого пейнта. Открыть по отдельности:
        <NuxtLink :to="`/demo/csr?${query}`" target="_blank">клиентский</NuxtLink> ·
        <NuxtLink :to="`/demo/ssr?${query}`" target="_blank">серверный</NuxtLink>.
      </div>

      <div class="note">
        <b>Как загружаются картинки.</b> Порядком управляет JS: файлы берутся
        <code>fetch</code>'ем по очереди, слева направо и сверху вниз, а показываются
        через <code>createObjectURL</code>. Не «прогрев кеша с последующей подстановкой
        <code>src</code>»: тот приём ломается на некешируемых ответах, а замедленные
        ответы обязаны быть <code>no-store</code>, иначе повторный прогон стал бы
        мгновенным. Перед снятием блюра ждём <code>img.decode()</code>, чтобы подмена
        не давала рывка.
        <br><br>
        Сервер притормаживает каждый файл ровно на столько, сколько он ехал бы
        по выбранному каналу: задержка сети плюс размер, делённый на полосу.
        Тяжёлая картинка ждёт дольше лёгкой — в этом отличие от фиксированной паузы.
      </div>
    </div>
  </div>
</template>

<style scoped>
.cmp-bar {
  position: sticky; top: 57px; z-index: 8;
  background: var(--bg); border-bottom: 1px solid var(--line);
  padding: 12px 20px;
}
.cmp-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.hint { font-size: 13px; }

.ab { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 18px 20px 0; }
.pane { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.pane-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 9px 14px; font-size: 14px;
}
.pane-bad { background: color-mix(in oklab, #d97706 16%, var(--bg)); }
.pane-good { background: color-mix(in oklab, var(--rec) 16%, var(--bg)); }
.pane-stat { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--dim); }

iframe { width: 100%; height: 68vh; border: 0; background: var(--bg); display: block; }

.cmp-notes { padding: 4px 20px 70px; max-width: 1500px; }

@media (max-width: 1000px) {
  .ab { grid-template-columns: 1fr; }
  iframe { height: 52vh; }
}
</style>
