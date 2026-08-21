<script setup lang="ts">
/**
 * Обычная оболочка страницы: навигация плюс содержимое.
 *
 * Вынесена из `app.vue` в лейаут, чтобы демо-страницы могли от неё отказаться
 * через `definePageMeta({ layout: false })`. Они открываются внутри iframe,
 * и шапка сайта там только мешает — это отдельный документ, а не раздел.
 */
</script>

<template>
  <div>
    <nav class="topbar">
      <NuxtLink to="/" class="brand">Демка загрузки изображений</NuxtLink>
      <NuxtLink to="/compare">Сравнение</NuxtLink>
      <NuxtLink to="/">Каталог</NuxtLink>
      <NuxtLink to="/upload">Загрузка</NuxtLink>
      <NuxtLink to="/why">Зачем это нужно</NuxtLink>
    </nav>
    <slot />
  </div>
</template>
