import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
 */
const REVEAL_WATCHER = `
document.documentElement.classList.add('reveal');
document.addEventListener('load', function (e) {
  var t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  var slot = t.parentElement;
  if (slot && slot.classList.contains('pcard-media')) slot.classList.add('is-loaded');
}, true);
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
});
