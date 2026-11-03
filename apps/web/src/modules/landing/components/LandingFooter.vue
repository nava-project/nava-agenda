<script setup lang="ts">
import { NavaWordmark } from '@/shared/ui'

const year = new Date().getFullYear()
</script>

<template>
  <footer class="ft">
    <div class="ln-wrap ft__row">
      <NavaWordmark variant="inverted" />
      <p>Gestión para barberías y salones · {{ year }}</p>
    </div>
  </footer>
</template>

<style scoped>
.ft {
  border-top: 1px solid var(--ln-line);
  padding: 32px 0 40px;
}

.ft__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
}

.ft__row :deep(.nava-wordmark) {
  font-size: 22px;
  letter-spacing: 0.14em;
}

.ft p {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--ln-muted);
}
</style>
