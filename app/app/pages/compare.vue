<script setup lang="ts">
/**
 * Сравнение двух стратегий рендера — двумя НАСТОЯЩИМИ загрузками страницы.
 *
 * Слева и справа — не два блока одной страницы, а два независимых документа
 * в iframe: `/demo/csr` и `/demo/ssr`. Клиентская стратегия должна честно
 * пройти весь свой путь — получить пустой HTML, скачать и исполнить JS, сходить
 * за данными и только потом отрисовать карточки. Внутри одной страницы это
 * не воспроизвести: там данные уже есть.
 *
 * ── Прокрутка ──────────────────────────────────────────────────────────────
 * Единственный источник правды — полоса ЭТОЙ страницы. Кадры собственной
 * прокрутки не имеют вовсе (`overflow: hidden` внутри) и лишь исполняют
 * присланное смещение. Взаимная синхронизация двух полос неизбежно давала бы
 * петлю и дрожание; здесь синхронизировать нечего — источник один.
 *
 * Длину полосы задаёт распорка `.stage` высотой во весь ход прокрутки,
 * а сами панели держатся на месте через `position: sticky`.
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

/** Высота содержимого каждого кадра — по ней считается ход прокрутки. */
const heights = reactive<Record<string, number>>({ csr: 0, ssr: 0 });

/** Видимая высота кадра. */
const VIEW_H = 620;

/** Насколько всего можно прокрутить: по самому длинному из кадров. */
const scrollRange = computed(() =>
  Math.max(0, Math.max(heights.csr, heights.ssr) - VIEW_H),
);

const stageEl = ref<HTMLElement | null>(null);

/**
 * Рассылает обоим кадрам одно и то же смещение.
 *
 * Кадры берём запросом к DOM, а не шаблонной ссылкой: одинаковый `ref` на двух
 * статических элементах Vue в массив НЕ собирает — второй перезаписывает первый,
 * и перебор падает. Массив получается только внутри `v-for`.
 */
function pushOffset(top: number) {
  const frames = stageEl.value?.querySelectorAll('iframe');
  frames?.forEach((f) => f.contentWindow?.postMessage({ type: 'demo:scrollTo', top }, '*'));
}

let raf = 0;
function onScroll() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = stageEl.value;
    if (!el) return;
    // Сколько прокручено внутри распорки, с обрезкой по её границам.
    const passed = -el.getBoundingClientRect().top + STICKY_TOP;
    pushOffset(Math.min(Math.max(passed, 0), scrollRange.value));
  });
}

/** Отступ, на котором залипают панели. Совпадает со значением в стилях. */
const STICKY_TOP = 118;

function onMessage(e: MessageEvent) {
  const d = e.data;
  if (d?.type === 'demo:progress' && d.strategy in stats) {
    stats[d.strategy] = {
      done: d.done, total: d.total, elapsed: d.elapsed, bytes: d.bytes, fetching: d.fetching,
    };
  }
  if (d?.type === 'demo:height' && d.strategy in heights) {
    heights[d.strategy] = d.height;
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  window.addEventListener('scroll', onScroll, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  window.removeEventListener('scroll', onScroll);
  if (raf) cancelAnimationFrame(raf);
});

/** Перезапускает оба кадра: пересоздание iframe = настоящая новая загрузка. */
function restart() {
  stats.csr = { done: 0, total: 0, elapsed: 0, bytes: 0 };
  stats.ssr = { done: 0, total: 0, elapsed: 0, bytes: 0 };
  heights.csr = 0;
  heights.ssr = 0;
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  runId.value += 1;
}

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`);
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

    <!-- Распорка задаёт длину полосы прокрутки; панели внутри залипают. -->
    <div ref="stageEl" class="stage" :style="{ height: `${VIEW_H + 52 + scrollRange}px` }">
      <div class="stage-inner">
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
          <iframe
            :key="`csr-${runId}`"
            :src="`/demo/csr?${query}`"
            title="Клиентский рендер"
            scrolling="no"
          />
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
          <iframe
            :key="`ssr-${runId}`"
            :src="`/demo/ssr?${query}`"
            title="SSR с плейсхолдерами"
            scrolling="no"
          />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cmp-bar {
  position: sticky; top: 57px; z-index: 9;
  background: var(--bg); border-bottom: 1px solid var(--line);
  padding: 12px 20px;
}
.cmp-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.hint { font-size: 13px; }

/* Распорка не видна: её единственная задача — задать длину полосы прокрутки. */
.stage { position: relative; padding: 0 20px; }
.stage-inner {
  position: sticky;
  top: 118px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.pane { border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column; background: var(--bg); }
.pane-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 9px 14px; font-size: 14px;
}
.pane-bad { background: color-mix(in oklab, #d97706 16%, var(--bg)); }
.pane-good { background: color-mix(in oklab, var(--rec) 16%, var(--bg)); }
.pane-stat { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--dim); }

iframe { width: 100%; height: 620px; border: 0; background: var(--bg); display: block; }

@media (max-width: 1000px) {
  .stage-inner { grid-template-columns: 1fr; }
}
</style>
