/**
 * Сокращение имён классов на сборке — единственный источник правды.
 *
 * Исходники остаются читаемыми (`pcard-supplier-name`), наружу уезжает `_g`.
 * Карта нужна в двух местах: плагин сборки переписывает по ней исходные файлы,
 * а `nuxt.config.ts` собирает по ней наблюдатель за загрузкой фотографий —
 * тот живёт строкой в конфиге, и до него плагин не дотягивается.
 *
 * Замер, чтобы ожидания были верными: сокращение имён экономит около 107 байт
 * по проводу, полпроцента документа. Разметка повторяется сорок раз и почти
 * целиком съедается сжатием. Делается ради полноты, а не ради скорости.
 */

/**
 * Классы, подлежащие сокращению.
 *
 * Список явный, а не выведенный из стилей: так его видно на ревью и нельзя
 * случайно задеть класс, который где-то собирается из кусков.
 *
 * НЕ входят и входить не должны:
 *   · `ph-<uuid>` — собирается на лету и в разметке, и в блоке стилей
 *     (`buildPlaceholderCss`). Переписать исходники здесь нечего: этих строк
 *     в исходниках нет, они появляются только во время выполнения.
 *   · классы страницы сравнения (`cmp-*`, `pane*`, `stage*`, `metrics`…) —
 *     она не участвует в замерах, а риск задеть её вёрстку не нужен.
 */
const NAMES = [
  // карточка товара
  'pcard-supplier-name',
  'pcard-title-wrap',
  'pcard-media',
  'pcard-supplier',
  'pcard-action',
  'pcard-bottom',
  'pcard-badge',
  'pcard-minqty',
  'pcard-price',
  'pcard-title',
  'pcard-link',
  'pcard-logo',
  'pcard-btn',
  'pcard',
  // сетка и страницы демонстрации
  'demo-viewport',
  'demo-empty',
  'demo-page',
  'demo-foot',
  'demo-sync',
  'dgrid',
  // состояния
  'is-embedded',
  'is-pending',
  'is-loaded',
  'has-ph',
  'reveal',
] as const;

/**
 * Короткое имя по номеру: `_a`, `_b`, … `_z`, `_a0`, `_a1`, …
 *
 * Приставка подчёркиванием — намеренно. Односимвольное имя рискует совпасть
 * с чужим классом из какой-нибудь библиотеки, а выигрыш в один знак при сжатии
 * неотличим от нуля.
 */
function shortName(index: number): string {
  const letter = String.fromCharCode(97 + (index % 26));
  const round = Math.floor(index / 26);
  return round === 0 ? `_${letter}` : `_${letter}${round - 1}`;
}

/** Длинное имя → короткое. */
export const CLASS_MAP: Record<string, string> = Object.fromEntries(
  NAMES.map((name, i) => [name, shortName(i)]),
);

/**
 * Короткое имя класса для мест, куда плагин сборки не дотягивается.
 * @param name Длинное имя из списка выше.
 * @returns Короткое имя, либо исходное, если класс не в списке.
 */
export function cls(name: string): string {
  return CLASS_MAP[name] ?? name;
}

/**
 * Порядок замены — от длинных имён к коротким.
 *
 * Обязательно: иначе `pcard` съел бы приставку у `pcard-media` и превратил его
 * в `_n-media`. Дефис — не буквенный знак, поэтому граница слова тут не спасает.
 */
const ORDERED = [...NAMES].sort((a, b) => b.length - a.length);

/** Готовые выражения замены, собираются один раз. */
const PATTERNS = ORDERED.map(
  (name) => [new RegExp(`\\b${name.replace(/[-]/g, '\\-')}\\b`, 'g'), CLASS_MAP[name]!] as const,
);

/**
 * Переписывает имена классов в тексте исходника.
 *
 * Замена текстовая, по всему файлу — включая шаблон, стили, строковые литералы
 * в скриптах и селекторы вида `document.querySelector('.demo-page')`. Именно это
 * и нужно: класс живёт во всех трёх местах сразу, и разъехаться они не должны.
 *
 * @param source Содержимое файла `.vue`, `.css` или `.ts`.
 * @returns Тот же текст с сокращёнными именами.
 */
export function renameClasses(source: string): string {
  let out = source;
  for (const [pattern, short] of PATTERNS) out = out.replace(pattern, short);
  return out;
}
