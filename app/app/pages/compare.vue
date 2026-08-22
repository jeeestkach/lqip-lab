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

useHead({ title: 'Сравнение стратегий рендера' });

const ph = useQueryParam('ph', '20');

/** Счётчик перезапусков: меняясь, он пересоздаёт оба iframe. */
const runId = ref(0);

const query = computed(() => `ph=${ph.value}&r=${runId.value}`);

/** Живая статистика каждого кадра. */
const stats = reactive<Record<string, { done: number; total: number; elapsed: number; bytes: number; fetching?: boolean }>>({
  csr: { done: 0, total: 0, elapsed: 0, bytes: 0 },
  ssr: { done: 0, total: 0, elapsed: 0, bytes: 0 },
});

/** Высота содержимого каждого кадра — по ней считается ход прокрутки. */
const heights = reactive<Record<string, number>>({ csr: 0, ssr: 0 });

/** Начальный объём каждой стратегии: HTML, стили, скрипты, ответы API. */
const payloads = reactive<Record<string, any>>({ csr: null, ssr: null });

/** Вехи загрузки каждой стратегии. */
const marks = reactive<Record<string, any>>({ csr: null, ssr: null });

/** Что видит краулер без исполнения JS. Запрашивается по кнопке. */
const seo = reactive<Record<string, any>>({ csr: null, ssr: null });
const seoBusy = ref(false);

async function runSeoAudit() {
  seoBusy.value = true;
  try {
    const [csr, ssr] = await Promise.all([
      $fetch('/api/seo-audit', { query: { path: `/demo/csr?${query.value}` } }),
      $fetch('/api/seo-audit', { query: { path: `/demo/ssr?${query.value}` } }),
    ]);
    seo.csr = csr;
    seo.ssr = ssr;
  } finally {
    seoBusy.value = false;
  }
}

/** Насколько показатель отличается от эталона — клиентской стратегии. */
function delta(base: number, value: number): string {
  if (!base) return value ? '—' : '';
  const d = ((value - base) / base) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(0)} %`;
}

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
  if (d?.type === 'demo:payload' && d.strategy in payloads) {
    payloads[d.strategy] = d.payload;
  }
  if (d?.type === 'demo:milestones' && d.strategy in marks) {
    marks[d.strategy] = d.milestones;
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
  payloads.csr = null;
  payloads.ssr = null;
  marks.csr = null;
  marks.ssr = null;
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  runId.value += 1;
}

/** Строки таблицы объёма. */
const payloadRows = [
  { key: 'document', label: 'HTML-документ', lowerIsBetter: true },
  { key: 'css', label: 'стили', lowerIsBetter: true },
  { key: 'js', label: 'скрипты', lowerIsBetter: true },
  { key: 'json', label: 'ответы API', lowerIsBetter: true },
  { key: 'total', label: 'всего до первой отрисовки', lowerIsBetter: true },
];

/** Строки таблицы «что видит краулер». */
const seoRows = [
  { key: 'title', label: 'заголовок страницы', moreIsBetter: false },
  { key: 'cards', label: 'карточек товара в разметке', moreIsBetter: true },
  { key: 'productNames', label: 'названий товаров', moreIsBetter: true },
  { key: 'images', label: 'тегов img', moreIsBetter: true },
  { key: 'imagesWithAlt', label: 'из них с alt', moreIsBetter: true },
  { key: 'placeholders', label: 'плейсхолдеров в документе', moreIsBetter: true },
  { key: 'textLength', label: 'символов видимого текста', moreIsBetter: true },
  { key: 'bytes', label: 'вес документа, байт', moreIsBetter: false },
];

/** Подсвечивает разницу: зелёным то, что лучше эталона. */
function deltaClass(base: number, value: number, lowerIsBetter: boolean) {
  if (!base || base === value) return '';
  const better = lowerIsBetter ? value < base : value > base;
  return better ? 'good' : 'bad';
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
          плейсхолдер
          <select v-model="ph">
            <option value="12">12 px</option>
            <option value="20">20 px</option>
            <option value="32">32 px</option>
            <option value="50">50 px</option>
          </select>
        </label>


        <span class="dim hint">
          Каталог порциями по 40 — следующая заказывается за 30 % до низа.
          Параметры применяются кнопкой «С начала».
        </span>
      </div>
    </div>

    <!-- Распорка задаёт длину полосы прокрутки; панели внутри залипают. -->
    <div ref="stageEl" class="stage" :style="{ height: `${VIEW_H + 52 + scrollRange}px` }">
      <div class="stage-inner">
        <section class="pane">
          <header class="pane-head pane-bad">
            <b>Только клиентский рендер</b>
            <span class="pane-stat">
              <template v-if="marks.csr">карточки видны: <b>{{ fmtMs(marks.csr.cardsVisible) }}</b></template>
              <template v-else>ждёт скрипты и ответ API…</template>
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
              <template v-if="marks.ssr">карточки видны: <b>{{ fmtMs(marks.ssr.cardsVisible) }}</b></template>
              <template v-else>рисуется…</template>
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

    <div class="cmp-warn">
      <b>Ответ зависит от того, лежат ли скрипты в кеше — и это не мелочь.</b>
      На ПЕРВОМ визите серверный рендер выигрывает заметно: карточки видны на 568 мс
      против 1581 мс, потому что клиентской стратегии сначала нужно скачать
      и выполнить 79 КБ скриптов, а только потом сходить за данными.
      На ПОВТОРНОМ визите, когда скрипты уже в кеше, картина переворачивается:
      клиентская показывает за 249 мс, серверная за 343 мс — её документ
      весит 110 КБ против 2,4 КБ и передаётся дольше, чем экономится на запросе.
      <br><br>
      Два кадра ниже грузятся ОДНОВРЕМЕННО и делят канал, поэтому глазами
      сравнивать их некорректно — смотрите на числа в шапках панелей.
    </div>

    <div class="metrics">
      <section class="mblock">
        <div class="mhead">
          <h2>Когда пользователь видит товар</h2>
          <span class="dim">Миллисекунды от начала загрузки. Замерено в самих кадрах.</span>
        </div>

        <div v-if="!marks.csr || !marks.ssr" class="dim mnote">
          Нажмите «С начала» — вехи снимаются при отрисовке карточек.
        </div>

        <table v-else>
          <thead>
            <tr>
              <th>Веха</th>
              <th class="num">Клиентский<br><span class="dim">эталон</span></th>
              <th class="num">SSR</th>
              <th class="num">разница</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>документ получен</td>
              <td class="num">{{ marks.csr.document }} мс</td>
              <td class="num">{{ marks.ssr.document }} мс</td>
              <td class="num" :class="deltaClass(marks.csr.document, marks.ssr.document, true)">
                {{ delta(marks.csr.document, marks.ssr.document) }}
              </td>
            </tr>
            <tr class="caveat">
              <td>первый пиксель<br><span class="dim">у клиентской это надпись, не товар</span></td>
              <td class="num">{{ marks.csr.firstPaint }} мс</td>
              <td class="num">{{ marks.ssr.firstPaint }} мс</td>
              <td class="num">—</td>
            </tr>
            <tr class="tot">
              <td>
                ПЕРВОЕ ИЗОБРАЖЕНИЕ ВИДНО
                <br><span class="dim">у SSR — плейсхолдер, у клиентского — фотография,
                потому что до неё там пусто</span>
              </td>
              <td class="num">{{ marks.csr.firstImagery || '—' }} мс</td>
              <td class="num">{{ marks.ssr.firstImagery || '—' }} мс</td>
              <td class="num" :class="deltaClass(marks.csr.firstImagery, marks.ssr.firstImagery, true)">
                {{ delta(marks.csr.firstImagery, marks.ssr.firstImagery) }}
              </td>
            </tr>
            <tr>
              <td>товар виден</td>
              <td class="num">{{ marks.csr.cardsVisible }} мс</td>
              <td class="num">{{ marks.ssr.cardsVisible }} мс</td>
              <td class="num" :class="deltaClass(marks.csr.cardsVisible, marks.ssr.cardsVisible, true)">
                {{ delta(marks.csr.cardsVisible, marks.ssr.cardsVisible) }}
              </td>
            </tr>
          </tbody>
        </table>

        <p class="dim mnote">
          Троттлинг здесь <b>не эмулируется</b>: сервер локальный, задержки сети почти нет.
          Чтобы увидеть настоящую разницу, включите ограничение в DevTools → Network
          и нажмите «С начала».
        </p>
      </section>

      <section class="mblock">
        <div class="mhead">
          <h2>Начальный объём страницы</h2>
          <span class="dim">HTML, стили, скрипты и ответы API. Изображения не в счёт — они одинаковы.</span>
        </div>

        <div v-if="!payloads.csr || !payloads.ssr" class="dim mnote">
          Нажмите «С начала» — цифры снимаются с каждого кадра после загрузки.
        </div>

        <table v-else>
          <thead>
            <tr>
              <th>Что</th>
              <th class="num">Клиентский рендер<br><span class="dim">эталон</span></th>
              <th class="num">SSR</th>
              <th class="num">разница</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in payloadRows" :key="row.key" :class="{ tot: row.key === 'total' }">
              <td>{{ row.label }}</td>
              <td class="num">{{ fmt(payloads.csr[row.key]) }}</td>
              <td class="num">{{ fmt(payloads.ssr[row.key]) }}</td>
              <td class="num" :class="deltaClass(payloads.csr[row.key], payloads.ssr[row.key], row.lowerIsBetter)">
                {{ delta(payloads.csr[row.key], payloads.ssr[row.key]) }}
              </td>
            </tr>
            <tr>
              <td>запросов</td>
              <td class="num">{{ payloads.csr.requests }}</td>
              <td class="num">{{ payloads.ssr.requests }}</td>
              <td class="num">{{ payloads.ssr.requests - payloads.csr.requests }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="mblock">
        <div class="mhead">
          <h2>Что видит краулер без JS</h2>
          <span class="dim">Разбор того самого HTML, который сервер отдаёт роботу.</span>
          <button class="ghost" :disabled="seoBusy" @click="runSeoAudit()">
            {{ seoBusy ? 'Проверяю…' : 'Проверить' }}
          </button>
        </div>

        <div v-if="!seo.csr || !seo.ssr" class="dim mnote">
          Нажмите «Проверить» — сервер запросит обе страницы и разберёт их разметку.
        </div>

        <table v-else>
          <thead>
            <tr>
              <th>Что</th>
              <th class="num">Клиентский рендер<br><span class="dim">эталон</span></th>
              <th class="num">SSR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in seoRows" :key="row.key" :class="{ caveat: row.key === 'images' || row.key === 'imagesWithAlt' }">
              <td>{{ row.label }}</td>
              <td class="num" :class="{ bad: row.moreIsBetter && !seo.csr[row.key] }">
                {{ typeof seo.csr[row.key] === 'number' ? seo.csr[row.key] : seo.csr[row.key] || '—' }}
              </td>
              <td class="num" :class="{ good: row.moreIsBetter && seo.ssr[row.key] > seo.csr[row.key] }">
                {{ typeof seo.ssr[row.key] === 'number' ? seo.ssr[row.key] : seo.ssr[row.key] || '—' }}
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="seo.ssr" class="dim mnote">
          Теги <code>&lt;img&gt;</code> со <code>src</code> и <code>alt</code> рендерит
          сервер — именно их находит предсканер и начинает качать файлы ещё при разборе
          HTML. У клиентской стратегии в документе нет ни одного: там пустая оболочка.
          В счёт идёт только первая порция — остальные догружаются по мере прокрутки
          и краулеру, как и пользователю, достаются позже.
        </p>
      </section>
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

/* ——— таблицы сравнения ——— */
.metrics {
  max-width: 1500px; margin: 0 auto; padding: 34px 20px 80px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 30px; align-items: start;
}
.mblock { min-width: 0; }
.mhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.mhead h2 { margin: 0; font-size: 17px; }
.mhead .dim { font-size: 13px; flex: 1 1 240px; }
.mnote { font-size: 13px; padding: 14px 0; }

.metrics table { border-collapse: collapse; width: 100%; font-size: 13.5px; margin-top: 10px; }
.metrics th, .metrics td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); }
.metrics th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); font-weight: 600; }
.metrics th .dim { text-transform: none; letter-spacing: 0; font-size: 11px; }
.metrics .num { text-align: right; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
.metrics tr.tot td { font-weight: 700; border-top: 1px solid var(--line); }
.metrics .good { color: var(--rec); }
.metrics .bad { color: #d97706; }
/* Показатели, которые в этой демке не сравнимы между стратегиями. */
.metrics tr.caveat td { opacity: .45; }

.cmp-warn {
  max-width: 1500px; margin: 18px auto 0; padding: 12px 16px;
  border-left: 3px solid #d97706; border-radius: 0 8px 8px 0;
  background: var(--panel); font-size: 14px;
}

@media (max-width: 1000px) {
  .stage-inner { grid-template-columns: 1fr; }
  .metrics { grid-template-columns: 1fr; }
}
</style>
