import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classMinifier } from './buildtools/class-minifier';
import { cls } from './buildtools/class-map';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Наблюдатель за загрузкой фотографий — один на весь документ.
 *
 * Ставится в head, до того как разборщик дойдёт до первой карточки, поэтому
 * не пропускает ни одной загрузки. Раньше момент ловил обработчик Vue на самой
 * карточке, и это был дефект: фотографии регулярно приходят РАНЬШЕ, чем
 * выполнится код фреймворка (замер: фото готовы на 611–702 мс, скрипты — на
 * 515–1133 мс). Событие к тому времени давно прошло, а обработчик вешался на
 * пустое место — на живой странице так терялось 7 карточек из 30.
 *
 * Событие `load` не всплывает, но перехватывается на погружении — отсюда
 * третий аргумент. Один слушатель обслуживает и первую порцию, и все
 * догруженные, и ничего не знает про Vue.
 *
 * Класс `reveal` на корне включает затухание в стилях. Без скрипта его не будет,
 * и фотографии останутся видимыми сразу — страница обязана работать, даже если
 * этот код не выполнился.
 *
 * ── Почему проявляется не всё подряд ────────────────────────────────────────
 * Повторный заход выглядит иначе: документ берётся из кеша, а снимки лежат
 * там же — адреса содержат хеш содержимого и живут с пометкой «неизменно».
 * В таком заходе размытие и проявление ВРЕДЯТ: показывать пятно вместо готовой
 * фотографии и потом четверть секунды её проявлять — это придуманная задержка
 * на ровном месте.
 *
 * Различаем по `complete` на первом кадре после разбора: снимок из кеша к тому
 * времени готов, сетевой — нет. Проявляются только вторые. Смотрим именно
 * на кадр, а не на момент загрузки: решать в обработчике `load` значило бы
 * гасить уже нарисованную фотографию, а это мигание.
 *
 * Имена классов берутся из общей карты сокращений: этот код живёт строкой
 * в конфиге, и плагин сборки до него не дотягивается — подставляем сами,
 * иначе селектор разошёлся бы с сокращёнными именами в разметке.
 */
const REVEAL_WATCHER = `
(function () {
  var R = document.documentElement.classList;
  R.add('${cls('reveal')}');
  var MEDIA = '${cls('pcard-media')}', PENDING = '${cls('is-pending')}', LOADED = '${cls('is-loaded')}';

  // Помечаем ждущими только те снимки, что на момент осмотра ещё не приехали.
  // Уже готовые не трогаем вовсе: им проявляться не из чего и незачем.
  function mark(scope) {
    var list = scope.querySelectorAll('.' + MEDIA + ' img');
    for (var i = 0; i < list.length; i++) {
      var img = list[i];
      if (!img.complete && img.parentElement) img.parentElement.classList.add(PENDING);
    }
  }

  document.addEventListener('load', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var slot = t.parentElement;
    if (slot && slot.classList.contains(PENDING)) slot.classList.add(LOADED);
  }, true);

  function start() {
    // Кадр после разбора: к этому моменту снимки из кеша браузера уже готовы,
    // а сетевые — ещё нет. Именно это различие нам и нужно.
    requestAnimationFrame(function () { mark(document); });

    // Догруженные порции приходят позже и всегда идут по сети — их помечаем
    // при появлении, иначе они проступали бы рывком.
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) mark(added[j]);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`.trim();

/**
 * Демка трёхступенчатой загрузки изображений.
 * SSR обязателен: весь смысл в том, что плейсхолдер приезжает уже в HTML.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  ssr: true,
  devtools: { enabled: false },

  runtimeConfig: {
    /** Каталог объектного хранилища. Меняется через NUXT_STORAGE_ROOT. */
    storageRoot: path.join(rootDir, '.data', 'objects'),
  },

  nitro: {
    // Статику жмём на сборке; динамический HTML — плагином server/plugins/compression.ts.
    compressPublicAssets: { gzip: true, brotli: true },
    // Отдаём файлы через собственный маршрут /cdn/**, а не как статику:
    // так у нас свои заголовки кеширования и возможность притормозить ответ.
    routeRules: {
      '/cdn/**': { cors: true },
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      script: [{ innerHTML: REVEAL_WATCHER, tagPosition: 'head' }],
    },
  },

  css: ['~/assets/app.css'],

  vite: {
    // Сокращает имена классов до `_a`, `_b`… Исходники остаются читаемыми.
    plugins: [classMinifier()],
  },
});
