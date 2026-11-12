<script setup lang="ts">
import { withBase } from "vitepress"

/** A product screenshot that follows the site theme when a dark variant exists. */
defineProps<{ name: string; alt: string; dark?: boolean; caption?: string }>()
</script>

<template>
  <figure class="shot">
    <img :src="withBase(`/screenshots/${name}-light.png`)" :alt="alt" :class="{ 'only-light': dark }" loading="lazy" width="1440" height="900" />
    <img v-if="dark" :src="withBase(`/screenshots/${name}-dark.png`)" :alt="alt" class="only-dark" loading="lazy" width="1440" height="900" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.shot {
  margin: 24px 0;
}
.shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 32px -16px rgba(0, 0, 0, 0.18);
}
.shot figcaption {
  margin-top: 10px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-align: center;
}
.only-dark {
  display: none !important;
}
:global(.dark) .shot .only-light {
  display: none !important;
}
:global(.dark) .shot .only-dark {
  display: block !important;
}
</style>
