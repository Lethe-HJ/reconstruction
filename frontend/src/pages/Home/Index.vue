<script setup lang="ts">
import { ref, onMounted } from 'vue'

const canvasRef = ref<HTMLCanvasElement | null>(null)

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = '#7aa2f7'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#1a1b26'
  context.font = '24px sans-serif'
  context.fillText('Home Canvas', 16, 40)
})
</script>

<template>
  <div style="padding: 24px; height: 100%">
    <canvas
      ref="canvasRef"
      width="600"
      height="400"
      style="max-width: 100%"
    />
  </div>
</template>
