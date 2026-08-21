<script setup lang="ts">
/** Оболочка приложения: навигация и слот страницы. */
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
    <NuxtPage />
  </div>
</template>
