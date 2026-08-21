/**
 * GET /api/seo-audit?path=/demo/ssr — что видит краулер, который НЕ исполняет JS.
 *
 * Запрашиваем собственную страницу с сервера и разбираем ровно тот HTML, который
 * ушёл бы поисковому роботу или превью-боту мессенджера. Именно здесь и лежит
 * настоящая разница между стратегиями: клиентский рендер отдаёт пустую оболочку,
 * серверный — готовый документ с товарами.
 *
 * Разбор регулярками, без парсера в зависимостях: считаем простые и хорошо
 * определённые вещи — теги, атрибуты, длину текста. Для полноценного HTML-парсинга
 * это было бы негодным инструментом, для подсчёта тегов достаточно.
 */

/** Убирает скрипты, стили и теги — остаётся текст, который видит читатель. */
function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Считает вхождения шаблона. */
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? '');
  if (!path.startsWith('/')) {
    throw createError({ statusCode: 400, statusMessage: 'путь должен начинаться со слэша' });
  }

  // Запрашиваем сами себя тем же способом, что и внешний клиент.
  const html = await $fetch<string>(path, { responseType: 'text' }).catch(() => '');
  if (!html) throw createError({ statusCode: 502, statusMessage: 'страница не ответила' });

  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const withAlt = imgs.filter((t) => /\balt\s*=\s*"[^"]+"/i.test(t)).length;
  const text = textOf(html);

  return {
    path,
    /** Вес самого документа — то, что придёт до единого запроса за ресурсами. */
    bytes: Buffer.byteLength(html, 'utf8'),
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(),
    headings: count(html, /<h[1-6]\b/gi),
    /**
     * Карточек в разметке — главный показатель: есть ли товары без JS.
     * Считаем внешний контейнер, а не каждый его класс: `dcard-media`,
     * `dcard-body` и прочие иначе умножали бы результат впятеро.
     */
    cards: count(html, /class="dcard\b[^-]/gi),
    images: imgs.length,
    imagesWithAlt: withAlt,
    /** Плейсхолдеры, приехавшие прямо в документе. */
    placeholders: count(html, /data:image\/webp;base64/gi),
    /** Длина видимого текста — сколько содержимого получит робот. */
    textLength: text.length,
    /** Названия товаров, найденные в тексте: их индексирует поиск. */
    productNames: count(html, /class="[^"]*dcard-title/gi),
    hasJsonLd: /application\/ld\+json/i.test(html),

    /**
     * Оговорка к показателю `images`.
     *
     * В этой демке теги `<img>` ставит JS — так удаётся управлять порядком
     * загрузки, ради чего демка и сделана. В продакшне `<img>` с `src`,
     * `srcset` и `alt` рендерился бы сервером, а плейсхолдер лежал бы фоном
     * рамки. Поэтому по картинкам сравнивать стратегии здесь НЕЛЬЗЯ —
     * сравнивать надо по тексту, названиям товаров и весу документа.
     */
    imagesNote: 'теги img в этой демке ставит JS ради контроля порядка загрузки',
  };
});
