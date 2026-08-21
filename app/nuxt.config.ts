import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

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
    },
  },

  css: ['~/assets/app.css'],
});
