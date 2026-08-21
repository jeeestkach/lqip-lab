<script setup lang="ts">
/**
 * Контролируемое сравнение двух стратегий рендера на ОДНИХ И ТЕХ ЖЕ изображениях.
 *
 * Почему так, а не «наш localhost против живого сайта»: там не совпадают ни сервер,
 * ни латентность, ни CDN, и любой результат объяснялся бы этими различиями,
 * а не стратегией рендера. Здесь одна страница, один прогон, одна очередь —
 * отличается ровно одно: есть плейсхолдер или нет.
 *
 * Слева — как сейчас: пустое место до прихода файла.
 * Справа — плейсхолдер приезжает в HTML и виден первым пейнтом.
 *
 * Момент прихода каждого файла считает модель общей полосы (useLoadSimulator),
 * а не фиксированная задержка: тяжёлая картинка ждёт дольше лёгкой, и карточки
 * появляются неровными пачками — ровно как на настоящем каталоге.
 */

import { SPEEDS } from '~/composables/useLoadSimulator';

const { data } = await useFetch('/api/images');

useHead({ title: 'Сравнение стратегий — демка загрузки изображений' });

/** Профиль соединения. */
const speedKey = useQueryParam('speed', 'slow4g');
const speed = computed(() => SPEEDS.find((s) => s.key === speedKey.value) ?? SPEEDS[1]!);

/** Ширина плейсхолдера. Все варианты уже посчитаны при загрузке. */
const phWidth = useQueryParam('ph', '20');

/** Сколько карточек грузится в первую очередь — предзагрузка вперёд экрана. */
const preload = useQueryParam('preload', 6);

/** Сколько раз повторить набор, чтобы сетке было куда скроллить. */
const repeat = useQueryParam('repeat', 4);

const items = computed(() => {
  const base = data.value?.images ?? [];
  if (!base.length) return [];
  return Array.from({ length: base.length * repeat.value }, (_, i) => {
    const src = base[i % base.length]!;
    return { ...src, key: `${src.id}-${i}`, index: i };
  });
});

const fmt = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} с` : `${ms} мс`);

/** Плейсхолдер выбранной ширины. */
function ph(img: any): string {
  return img.placeholders?.[phWidth.value] ?? img.placeholder;
}

/** Карточная копия — то, что реально грузится в выдаче. */
function variant(img: any) {
  return img.variants.find((v: any) => v.width >= 300) ?? img.variants[0];
}

const phWeight = computed(() => items.value.reduce((s, i) => s + ph(i).length, 0));
const imageWeight = computed(() => items.value.reduce((s, i) => s + variant(i).bytes, 0));

// ——— прогон ———

const sim = useLoadSimulator();

/** Прогрев: тянем файлы в кеш, чтобы прогон измерял модель, а не сеть. */
const warming = ref(false);
const warmed = ref(false);

async function warmCache() {
  if (warmed.value || !items.value.length) return;
  warming.value = true;
  const urls = [...new Set(items.value.map((i) => variant(i).url))];
  await Promise.all(urls.map((u) => fetch(u).catch(() => undefined)));
  warming.value = false;
  warmed.value = true;
}

/**
 * Порядок загрузки: сначала предзагружаемые карточки, потом остальные.
 * Это и есть «предзагрузка вперёд экрана» — она меняет очередь, а не скорость.
 */
const queue = computed(() =>
  [...items.value]
    .sort((a, b) => {
      const ap = a.index < preload.value ? 0 : 1;
      const bp = b.index < preload.value ? 0 : 1;
      return ap - bp || a.index - b.index;
    })
    .map((i) => ({ key: i.key, bytes: variant(i).bytes })),
);

async function restart() {
  await warmCache();
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  sim.start(queue.value, speed.value);
}

/** Показывать ли настоящий файл этой карточки. */
function isArrived(key: string): boolean {
  return sim.arrived.value.has(key);
}

/** Прогон не запускается сам: демонстрация должна начинаться по команде. */
onMounted(() => { warmCache(); });
</script>

<template>
  <div class="cmp">
    <div class="cmp-bar">
      <div class="cmp-bar-row">
        <button :disabled="warming" @click="restart()">
          {{ warming ? 'Прогрев…' : 'С начала' }}
        </button>
        <button v-if="sim.running.value" class="ghost" @click="sim.stop()">Стоп</button>

        <label>
          скорость
          <select v-model="speedKey">
            <option v-for="s in SPEEDS" :key="s.key" :value="s.key">
              {{ s.label }} — {{ s.hint }}
            </option>
          </select>
        </label>

        <label>
          плейсхолдер
          <select v-model="phWidth">
            <option value="12">12 px</option>
            <option value="20">20 px</option>
            <option value="32">32 px</option>
            <option value="50">50 px</option>
          </select>
        </label>

        <label>
          предзагрузка
          <select v-model.number="preload">
            <option :value="0">нет</option>
            <option :value="6">6 карточек</option>
            <option :value="18">18 карточек</option>
          </select>
        </label>

        <label>
          карточек
          <select v-model.number="repeat">
            <option :value="1">14</option>
            <option :value="4">56</option>
            <option :value="8">112</option>
          </select>
        </label>
      </div>

      <div class="cmp-bar-row cmp-bar-stats">
        <span v-if="sim.total.value">
          пришло <b>{{ sim.arrived.value.size }}</b> из <b>{{ sim.total.value }}</b>
        </span>
        <span v-if="sim.total.value">прошло <b>{{ fmtMs(sim.elapsed.value) }}</b></span>
        <span v-if="sim.eta.value">все придут за <b>{{ fmtMs(sim.eta.value) }}</b></span>
        <span class="cmp-sep" />
        <span>картинок на <b>{{ fmt(imageWeight) }}</b></span>
        <span>плейсхолдеры {{ phWidth }} px — <b>{{ fmt(phWeight) }}</b> в HTML</span>
      </div>

      <div v-if="sim.total.value" class="cmp-progress">
        <i :style="{ width: `${(sim.arrived.value.size / sim.total.value) * 100}%` }" />
      </div>
    </div>

    <div class="cmp-body">
      <p class="dim intro">
        Момент прихода каждой карточки считается по весу файла и выбранной скорости,
        с учётом того, что браузер держит к источнику шесть соединений и они делят полосу.
        Поэтому карточки появляются неровными пачками — как на настоящем каталоге.
        Обе колонки идут по одной очереди: отличается только то, что видно до прихода файла.
      </p>

      <div v-if="!items.length" class="note">
        Пусто. <NuxtLink to="/upload">Загрузите изображения</NuxtLink>, чтобы сравнить.
      </div>

      <div v-else class="ab">
        <section>
          <h2 class="ab-head ab-head-bad">Без плейсхолдера — как сейчас</h2>
          <div class="ab-grid">
            <article v-for="img in items" :key="`a-${img.key}`" class="pcard">
              <div class="pcard-media" :style="{ aspectRatio: `${img.width} / ${img.height}` }">
                <img
                  v-if="isArrived(img.key)"
                  :src="variant(img).url"
                  :alt="img.title"
                  :width="img.width"
                  :height="img.height"
                  decoding="async"
                >
              </div>
              <div class="pcard-body">
                <div class="pcard-title">{{ img.title }}</div>
                <div class="pcard-price">{{ 350 + img.index * 37 }} ₽</div>
              </div>
            </article>
          </div>
        </section>

        <section>
          <h2 class="ab-head ab-head-good">С плейсхолдером в HTML</h2>
          <div class="ab-grid">
            <article v-for="img in items" :key="`b-${img.key}`" class="pcard">
              <div
                class="pcard-media has-ph is-fading"
                :class="{ 'is-loaded': isArrived(img.key) }"
                :style="{ aspectRatio: `${img.width} / ${img.height}`, '--ph': `url(${ph(img)})` }"
              >
                <img
                  v-if="isArrived(img.key)"
                  :src="variant(img).url"
                  :alt="img.title"
                  :width="img.width"
                  :height="img.height"
                  decoding="async"
                >
              </div>
              <div class="pcard-body">
                <div class="pcard-title">{{ img.title }}</div>
                <div class="pcard-price">{{ 350 + img.index * 37 }} ₽</div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div class="note" style="margin-top:28px">
        <b>Откуда взяты изображения и цифры.</b> В сетке — настоящие карточки с
        <code>cdn.provybor.com</code>, те же файлы <code>_md.webp</code>, что отдаёт живой каталог.
        Замер там же, режим Slow 4G, страница <code>/catalog?delivery_methods=OZON</code>:
        <b>30</b> изображений на выдаче, медиана загрузки одной карточки <b>1778 мс</b>,
        максимум <b>3575 мс</b>; в момент скролла <b>8 из 20</b> карточек в области экрана
        были без изображения; плейсхолдера нет ни у одной из <b>36</b> картинок.
        <br><br>
        Отдельно стоит сказать: сайт <i>уже</i> делает многое правильно — WebP и размерные
        варианты (<code>_sm</code>, <code>_md</code>) на месте. Недостающее звено ровно одно —
        плейсхолдер.
      </div>

      <div class="note">
        <b>Что тут честно, а что нет.</b> Время прихода считает модель, а не сеть: файлы
        заранее прогреты в кеш, чтобы прогон был точным и повторяемым. Модель упрощает —
        полоса делится поровну, накладные расходы TLS и HTTP/2-мультиплексирование не учтены.
        Зато обе колонки идут по одной и той же очереди, поэтому разница между ними
        объясняется только наличием плейсхолдера, и ничем больше.
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Панель приклеена под навигацией: параметры меняются на ходу,
   и ради них не должно приходиться скроллить наверх. */
.cmp-bar {
  position: sticky;
  top: 57px;
  z-index: 8;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 12px 20px 0;
}
.cmp-bar-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cmp-bar-stats { font-size: 13px; color: var(--dim); padding: 9px 0; }
.cmp-bar-stats b { color: var(--fg); font-family: ui-monospace, Menlo, monospace; }
.cmp-sep { flex: 1 1 auto; }

.cmp-progress { height: 3px; background: var(--line); margin: 0 -20px; }
.cmp-progress i { display: block; height: 100%; background: var(--rec); transition: width .12s linear; }

.cmp-body { max-width: 1500px; margin: 0 auto; padding: 22px 20px 80px; }
.intro { max-width: 90ch; }

.ab { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 20px; align-items: start; }
.ab-head {
  margin: 0 0 12px; font-size: 15px; padding: 8px 12px; border-radius: 8px;
  position: sticky; top: 176px; z-index: 5;
}
.ab-head-bad { background: color-mix(in oklab, #d97706 16%, var(--bg)); }
.ab-head-good { background: color-mix(in oklab, var(--rec) 16%, var(--bg)); }

.ab-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

.pcard { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--panel); }
.pcard-media { position: relative; overflow: hidden; background: var(--bg); }
.pcard-media img {
  display: block; width: 100%; height: 100%; object-fit: cover;
  position: relative; z-index: 1;
}
.pcard-body { padding: 8px 10px 10px; }
.pcard-title { font-size: 12px; line-height: 1.3; height: 2.6em; overflow: hidden; }
.pcard-price { font-size: 13px; font-weight: 700; margin-top: 4px;
  font-family: ui-monospace, Menlo, monospace; }

/**
 * Плейсхолдер отдельным слоем, а не фоном на самом <img>.
 *
 * Фоном на теге он остаётся резко-квадратным: браузер растягивает 20 пикселей
 * до двухсот билинейной интерполяцией, а она сглаживает только соседние пиксели
 * и на десятикратном увеличении даёт мягкие квадраты, а не размытие.
 * Настоящий блюр даёт filter, но повесить его на <img> нельзя — он размоет
 * и загруженную картинку тоже.
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

/* Плавная подмена: картинка проявляется поверх слоя, и только став непрозрачной,
   слой гаснет. Одновременное гашение дало бы вспышку — в середине перехода оба
   полупрозрачны и сквозь них просвечивает фон. */
.pcard-media.is-fading img { animation: appear .45s ease both; }
.pcard-media.is-fading.is-loaded::before { opacity: 0; transition: opacity .3s ease .45s; }

@keyframes appear { from { opacity: 0 } to { opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  .pcard-media.is-fading img { animation: none; }
  .pcard-media.is-fading.is-loaded::before { transition: none; }
}

@media (max-width: 1000px) {
  .ab { grid-template-columns: 1fr; }
  .ab-grid { grid-template-columns: repeat(2, 1fr); }
  .ab-head { top: 210px; }
}
</style>
