<script setup lang="ts">
/**
 * Корень приложения. Намеренно пустой: вся оболочка живёт в `layouts/default.vue`,
 * чтобы демо-страницы могли отказаться от неё через `definePageMeta({ layout: false })`.
 * Они открываются внутри iframe как самостоятельные документы.
 */
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
