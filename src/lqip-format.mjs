/**
 * Формат «одного числа» (CSS-only LQIP): константы, упаковка бит и генератор
 * CSS-декодера. Модуль намеренно чистый — только Math, никаких зависимостей,
 * поэтому один и тот же код исполняется и в Node при сборке, и в браузере
 * в интерактивной демке. Дублировать эту арифметику в двух местах нельзя:
 * малейшее расхождение кодера и декодера даёт неверный цвет.
 */

/** Смещение хранения: 20-битное значение кладётся в диапазон [−2^19, 2^19−1]. */
export const OFFSET = 2 ** 19;

/** Светлота ячейки/базы отображается в этот отрезок Oklab L при декоде. */
export const L_MIN = 0.2;
export const L_RANGE = 0.6;

/**
 * Полуширина диапазона осей цветности a/b.
 *
 * ОТКЛОНЕНИЕ ОТ СПЕЦИФИКАЦИИ, осознанное. У Рады диапазон ±0.35 — он рассчитан на
 * насыщенные цвета. Но у СРЕДНЕГО цвета фотографии цветность почти всегда мала:
 * замеры на реальных снимках дают |a|,|b| ≈ 0.01…0.08, тогда как шаг квантования
 * при ±0.35 равен 0.0875. То есть весь цвет фотографии умещается внутри одного
 * шага и схлопывается в нейтрально-серый — плейсхолдер теряет оттенок.
 *
 * Сужение до ±0.12 даёт шаг 0.03 и попадает в реальный разброс фотографий.
 * Кодер и CSS-декодер генерируются из этой константы, поэтому всегда согласованы;
 * несовместимо с чужим CSS, написанным под исходный диапазон.
 */
export const C_HALF = 0.12;
export const C_RANGE = C_HALF * 2;

/** Зажимает значение в отрезок. */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Квантует светлоту Oklab в 2 бита (0..3) по шкале декодера. */
export function quantL(L) {
  return clamp(Math.round(((L - L_MIN) / L_RANGE) * 3), 0, 3);
}

/**
 * Упаковывает базовый цвет и шесть ячеек яркости в одно 20-битное число.
 * @param baseLab Средний цвет всего изображения в Oklab: `{ L, a, b }`.
 * @param cellLs Массив из шести значений светлоты Oklab, сетка 3×2 слева направо.
 * @returns `{ value, ll, aaa, bbb, cells }`; value — то самое число для `--lqip`.
 */
export function packLqip(baseLab, cellLs) {
  const ll = quantL(baseLab.L);
  const aaa = clamp(Math.round(((baseLab.a + C_HALF) / C_RANGE) * 8), 0, 7);
  const bbb = clamp(Math.round(((baseLab.b + C_HALF) / C_RANGE) * 8 - 1), 0, 7);
  const cells = cellLs.map(quantL);

  // ca занимает старшие биты 18–19, дальше вниз до bbb в битах 0–2.
  const packed =
    (cells[0] << 18) | (cells[1] << 16) | (cells[2] << 14) |
    (cells[3] << 12) | (cells[4] << 10) | (cells[5] << 8) |
    (ll << 6) | (aaa << 3) | bbb;

  return { value: packed - OFFSET, ll, aaa, bbb, cells };
}

/** Разворачивает квантованный базовый цвет обратно в координаты Oklab. */
export function unpackBaseLab(ll, aaa, bbb) {
  return {
    L: (ll / 3) * L_RANGE + L_MIN,
    a: (aaa / 8) * C_RANGE - C_HALF,
    b: ((bbb + 1) / 8) * C_RANGE - C_HALF,
  };
}

/** Центры шести ячеек сетки 3×2 в процентах — позиции радиальных градиентов. */
const CELL_POS = [
  ['16.67%', '25%'], ['50%', '25%'], ['83.33%', '25%'],
  ['16.67%', '75%'], ['50%', '75%'], ['83.33%', '75%'],
];

/** Имена распакованных ячеек в порядке следования битов. */
const CELL_VARS = ['ca', 'cb', 'cc', 'cd', 'ce', 'cf'];

/**
 * Возвращает статический CSS-декодер — один блок на всё приложение.
 * Каждой картинке дальше нужно только `style="--lqip:<число>"`.
 * @returns Строка CSS.
 */
export function lqipIntDecoderCss() {
  const layers = CELL_VARS.map((name, i) => {
    const [x, y] = CELL_POS[i];
    const l = `calc(var(--_${name}) / 3 * ${L_RANGE} + ${L_MIN})`;
    const stop = (alpha) => `oklab(${l} var(--_a) var(--_b) / ${alpha})`;
    return `    radial-gradient(50% 75% at ${x} ${y}, ${stop(1)} 0%, ${stop(0)} 100%)`;
  }).join(',\n');

  return `@property --lqip {
  syntax: "<number>";
  inherits: true;
  initial-value: 0;
}

.ph-lqip-int {
  /* Разворачиваем 20-битное число: сдвиг вправо это деление, маска — mod(). */
  --_v: calc(var(--lqip) + ${OFFSET});
  --_ca: mod(round(down, calc(var(--_v) / 262144)), 4);
  --_cb: mod(round(down, calc(var(--_v) / 65536)), 4);
  --_cc: mod(round(down, calc(var(--_v) / 16384)), 4);
  --_cd: mod(round(down, calc(var(--_v) / 4096)), 4);
  --_ce: mod(round(down, calc(var(--_v) / 1024)), 4);
  --_cf: mod(round(down, calc(var(--_v) / 256)), 4);
  --_ll: mod(round(down, calc(var(--_v) / 64)), 4);
  --_aaa: mod(round(down, calc(var(--_v) / 8)), 8);
  --_bbb: mod(var(--_v), 8);

  /* Цветность общая на всю картинку, меняется только светлота по ячейкам.
     Диапазон ±${C_HALF} вместо ±0.35 из спецификации — см. комментарий в lqip-format.mjs. */
  --_a: calc(var(--_aaa) / 8 * ${C_RANGE} - ${C_HALF});
  --_b: calc((var(--_bbb) + 1) / 8 * ${C_RANGE} - ${C_HALF});

  /* Первое объявление — запасное, для браузеров без mod()/round()/oklab():
     там второе объявление невалидно и отбрасывается целиком. */
  background-color: var(--lqip-fallback, #9a9a9a);
  background-color: oklab(calc(var(--_ll) / 3 * ${L_RANGE} + ${L_MIN}) var(--_a) var(--_b));
  background-image:
${layers};
}
`;
}
