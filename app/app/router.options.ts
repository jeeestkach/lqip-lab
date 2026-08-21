import type { RouterConfig } from '@nuxt/schema';

/**
 * Настройка прокрутки при навигации.
 *
 * По умолчанию Nuxt прокручивает страницу наверх при любой смене адреса.
 * Но параметры демки живут в query, и менять их приходится по ходу прогона —
 * при каждой правке страница прыгала бы наверх, теряя то место, куда человек
 * смотрел. Поэтому навигации в пределах одного пути прокрутку не трогают.
 */
export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    if (to.path === from.path) return false;
    return savedPosition ?? { left: 0, top: 0 };
  },
};
