<script setup lang="ts">
/**
 * Контролируемое сравнение двух стратегий рендера на ОДНИХ И ТЕХ ЖЕ изображениях.
 *
 * Почему так, а не «наш localhost против живого сайта»: там не совпадают ни сервер,
 * ни латентность, ни CDN, и любой результат объяснялся бы этими различиями,
 * а не стратегией рендера. Здесь одна страница, один канал, одна задержка —
 * отличается ровно одно: есть плейсхолдер или нет.
 *
 * Слева — как сейчас: пустое место до прихода файла.
 * Справа — плейсхолдер приезжает в HTML и виден первым пейнтом.
 */

const { data } = await useFetch('/api/images');

useHead({ title: 'Сравнение стратегий — демка загрузки изображений' });

/** Задержка отдачи файлов, мс. */
const delay = useQueryParam('delay', 2000);

/** Ширина плейсхолдера. Все варианты уже посчитаны при загрузке. */
const phWidth = useQueryParam('ph', '20');

/** Сколько карточек грузить заранее, за пределами экрана. */
const preload = useQueryParam('preload', 4);

/**
 * Показать только плейсхолдеры, не подставляя настоящие файлы.
 *
 * Без этого рассмотреть их нельзя: на быстром соединении картинки успевают
 * прийти за доли секунды, и ловить нужный кадр приходится секундомером.
 * Здесь `<img>` просто не получает `src` — ровно то состояние, в котором
 * страница находится сразу после первого пейнта.
 */
const phOnly = useQueryParam('phonly', '0');
const showPlaceholdersOnly = computed({
  get: () => phOnly.value === '1',
  set: (v) => { phOnly.value = v ? '1' : '0'; },
});

/** Повторяем набор, чтобы сетка была длинной и скролл имел смысл. */
const REPEAT = 4;
const items = computed(() => {
  const base = data.value?.images ?? [];
  if (!base.length) return [];
  return Array.from({ length: base.length * REPEAT }, (_, i) => {
    const src = base[i % base.length]!;
    return { ...src, key: `${src.id}-${i}`, index: i };
  });
});

const fmt = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} КБ`);

/** Плейсхолдер выбранной ширины с запасным вариантом. */
function ph(img: any): string {
  return img.placeholders?.[phWidth.value] ?? img.placeholder;
}

/** Вес плейсхолдеров выбранной ширины на всю страницу. */
const phWeight = computed(() =>
  items.value.reduce((sum, i) => sum + ph(i).length, 0),
);

/**
 * URL карточной копии с демонстрационной задержкой.
 * В режиме «только плейсхолдеры» возвращает undefined — тег остаётся без `src`.
 */
function cardUrl(img: any): string | undefined {
  if (showPlaceholdersOnly.value) return undefined;
  const v = img.variants.find((x: any) => x.width >= 300) ?? img.variants[0];
  return delay.value > 0 ? `${v.url}?delay=${delay.value}` : v.url;
}

/** Первые N карточек грузим сразу, остальные лениво — это и есть предзагрузка. */
function isEager(index: number): boolean {
  return index < preload.value;
}
</script>

<template>
  <div class="wrap wide">
    <h1>Две стратегии, одни изображения</h1>
    <p class="dim">
      Слева — как на обычном каталоге: пока файл не пришёл, на месте карточки пусто.
      Справа — плейсхолдер уже в HTML и виден первым пейнтом. Изображения, канал и задержка
      одинаковые: отличается ровно одна вещь.
    </p>

    <div class="controls">
      <label>
        задержка отдачи
        <select v-model.number="delay">
          <option :value="0">нет</option>
          <option :value="800">0,8 с</option>
          <option :value="1800">1,8 с — замер на provybor.com</option>
          <option :value="5000">5 с</option>
          <option :value="20000">20 с — чтобы успеть рассмотреть</option>
        </select>
      </label>

      <label>
        плейсхолдер
        <select v-model="phWidth">
          <option value="12">12 px — 187 B</option>
          <option value="20">20 px — 287 B</option>
          <option value="32">32 px — 447 B</option>
          <option value="50">50 px — 859 B</option>
        </select>
      </label>

      <label>
        предзагрузка
        <select v-model.number="preload">
          <option :value="0">только видимое</option>
          <option :value="4">4 карточки</option>
          <option :value="12">12 карточек</option>
          <option :value="999">всё сразу</option>
        </select>
      </label>

      <label class="toggle">
        <input v-model="showPlaceholdersOnly" type="checkbox">
        показать только плейсхолдеры
      </label>

      <span class="dim" style="font-size:13px">после смены — перезагрузите (⌘R), параметры в адресе</span>
    </div>

    <div v-if="showPlaceholdersOnly" class="note">
      <b>Настоящие файлы не подставляются.</b> Это ровно то, что видит человек в первый момент,
      до прихода единственного байта картинок. Слева при этом честно пусто: без плейсхолдера
      показывать нечего.
    </div>

    <div class="stat-row">
      <span>карточек <b>{{ items.length }}</b></span>
      <span>плейсхолдеры {{ phWidth }} px в HTML <b>{{ fmt(phWeight) }}</b></span>
      <span>{{ fmt(Math.round(phWeight / items.length)) }} на карточку</span>
    </div>

    <div v-if="phWeight > 25000" class="note note-warn">
      <b>Осторожно с детальностью.</b> Плейсхолдеры {{ phWidth }} px весят {{ fmt(phWeight) }}
      на {{ items.length }} карточек — это уже заметная часть документа, и она грузится
      <i>до</i> всего остального. Смысл ступени 1 в том, чтобы HTML пришёл быстро;
      раздув его вчетверо, можно потерять больше, чем выиграть.
      Разумный потолок для длинных выдач — 20–32 px, а 50 px оставить для крупных
      изображений на странице товара.
    </div>

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
                :src="cardUrl(img)"
                :alt="showPlaceholdersOnly ? '' : img.title"
                :width="img.width"
                :height="img.height"
                :loading="isEager(img.index) ? 'eager' : 'lazy'"
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
            <div class="pcard-media" :style="{ aspectRatio: `${img.width} / ${img.height}` }">
              <img
                :src="cardUrl(img)"
                :alt="showPlaceholdersOnly ? '' : img.title"
                :width="img.width"
                :height="img.height"
                :loading="isEager(img.index) ? 'eager' : 'lazy'"
                decoding="async"
                :style="{ backgroundImage: `url(${ph(img)})`, backgroundSize: 'cover', backgroundPosition: 'center' }"
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
      <ul style="margin:8px 0 0">
        <li><b>30</b> изображений товаров на странице выдачи;</li>
        <li>медиана загрузки одной карточки — <b>1778 мс</b>, максимум <b>3575 мс</b>;</li>
        <li>в момент скролла <b>8 из 20</b> карточек в области экрана были без изображения;</li>
        <li>плейсхолдера нет ни у одной из <b>36</b> картинок страницы.</li>
      </ul>
      <br>
      Отдельно стоит сказать: сайт <i>уже</i> делает многое правильно — WebP и размерные
      варианты (<code>_sm</code>, <code>_md</code>) на месте. Недостающее звено ровно одно —
      плейсхолдер. Речь не о смене формата, а о добавлении одного шага в конвейер.
    </div>

    <div class="note">
      <b>Что тут честно, а что нет.</b> Это сравнение стратегий рендера, а не сайтов.
      Обе колонки грузят одинаковые файлы с одного сервера через одну и ту же искусственную
      задержку, поэтому разница объясняется только наличием плейсхолдера.
      Прямое сравнение с живым сайтом было бы недобросовестным: там другой сервер, другая
      латентность и другой CDN, и любой результат списался бы на них.
    </div>
  </div>
</template>

<style scoped>
.wide { max-width: 1500px; }

.ab { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 20px; align-items: start; }
.ab-head {
  margin: 0 0 12px; font-size: 15px; padding: 8px 12px; border-radius: 8px;
  position: sticky; top: 57px; z-index: 5;
}
.ab-head-bad { background: color-mix(in oklab, #d97706 16%, var(--bg)); color: var(--fg); }
.ab-head-good { background: color-mix(in oklab, var(--rec) 16%, var(--bg)); color: var(--fg); }

.ab-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

.pcard { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--panel); }
.pcard-media { position: relative; overflow: hidden; background: var(--bg); }
.pcard-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pcard-body { padding: 8px 10px 10px; }
.pcard-title { font-size: 12px; line-height: 1.3; height: 2.6em; overflow: hidden; }
.pcard-price { font-size: 13px; font-weight: 700; margin-top: 4px;
  font-family: ui-monospace, Menlo, monospace; }

@media (max-width: 1000px) {
  .ab { grid-template-columns: 1fr; }
  .ab-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
