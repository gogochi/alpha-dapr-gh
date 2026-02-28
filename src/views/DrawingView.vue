<template>
  <div class="drawing-view">
    <div class="page-header">
      <h2>✏️ DAPR 繪畫評估</h2>
      <div>
        <el-button @click="clearCanvas">清除</el-button>
        <el-button @click="undoStroke" :disabled="strokes.length === 0">復原</el-button>
        <el-button type="primary" @click="submitDrawing" :loading="submitting">提交分析</el-button>
      </div>
    </div>

    <el-alert
      title="請在下方畫布上繪製「雨中人」(Draw-A-Person-in-the-Rain)"
      description="請畫出一個在雨中的人。「雨」代表壓力事件或環境，請自由繪畫。"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    />

    <div class="canvas-container">
      <canvas
        ref="drawCanvas"
        width="800"
        height="600"
        @pointerdown="startStroke"
        @pointermove="drawStroke"
        @pointerup="endStroke"
        @pointerleave="endStroke"
        class="draw-canvas"
      ></canvas>
    </div>

    <div class="drawing-info">
      <el-tag>線條數: {{ strokes.length }}</el-tag>
      <el-tag type="info">已繪畫: {{ formatDuration(elapsedTime) }}</el-tag>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { createSketch } from '../services/db'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const drawCanvas = ref(null)
const strokes = ref([])
const currentStroke = ref(null)
const isDrawing = ref(false)
const submitting = ref(false)
const startTime = ref(null)
const elapsedTime = ref(0)
let timer = null

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

onMounted(() => {
  const canvas = drawCanvas.value
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2
  ctx.strokeStyle = '#333'
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function getPos(e) {
  const rect = drawCanvas.value.getBoundingClientRect()
  const scaleX = drawCanvas.value.width / rect.width
  const scaleY = drawCanvas.value.height / rect.height
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
    pressure: e.pressure || 0.5,
    timestamp: Date.now(),
  }
}

function startStroke(e) {
  if (!startTime.value) {
    startTime.value = Date.now()
    timer = setInterval(() => {
      elapsedTime.value = (Date.now() - startTime.value) / 1000
    }, 100)
  }

  isDrawing.value = true
  const pos = getPos(e)
  currentStroke.value = {
    stroke_id: strokes.value.length + 1,
    points: [pos],
    start_time: pos.timestamp,
    end_time: pos.timestamp,
  }

  const ctx = drawCanvas.value.getContext('2d')
  ctx.beginPath()
  ctx.moveTo(pos.x, pos.y)
}

function drawStroke(e) {
  if (!isDrawing.value || !currentStroke.value) return

  const pos = getPos(e)
  currentStroke.value.points.push(pos)
  currentStroke.value.end_time = pos.timestamp

  const ctx = drawCanvas.value.getContext('2d')
  ctx.lineTo(pos.x, pos.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(pos.x, pos.y)
}

function endStroke() {
  if (!isDrawing.value || !currentStroke.value) return
  isDrawing.value = false

  if (currentStroke.value.points.length > 1) {
    strokes.value.push(currentStroke.value)
  }
  currentStroke.value = null
}

function clearCanvas() {
  const ctx = drawCanvas.value.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, drawCanvas.value.width, drawCanvas.value.height)
  strokes.value = []
  startTime.value = null
  elapsedTime.value = 0
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function undoStroke() {
  strokes.value.pop()
  redrawAll()
}

function redrawAll() {
  const ctx = drawCanvas.value.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, drawCanvas.value.width, drawCanvas.value.height)
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 2

  for (const stroke of strokes.value) {
    if (stroke.points.length < 2) continue
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
  }
}

function calculateAvgLineLength() {
  if (strokes.value.length === 0) return 0
  let totalLength = 0
  for (const stroke of strokes.value) {
    let len = 0
    for (let i = 1; i < stroke.points.length; i++) {
      const dx = stroke.points[i].x - stroke.points[i - 1].x
      const dy = stroke.points[i].y - stroke.points[i - 1].y
      len += Math.sqrt(dx * dx + dy * dy)
    }
    totalLength += len
  }
  return totalLength / strokes.value.length
}

async function submitDrawing() {
  if (strokes.value.length === 0) {
    ElMessage.warning('請先繪畫')
    return
  }

  submitting.value = true
  if (timer) clearInterval(timer)

  try {
    const canvas = drawCanvas.value
    const imageDataUrl = canvas.toDataURL('image/png')

    const strokeData = {
      strokes: strokes.value,
      total_duration: elapsedTime.value,
      line_count: strokes.value.length,
      avg_line_length: calculateAvgLineLength(),
    }

    const sketch = await createSketch(authStore.user.id, {
      title: 'DAPR 繪畫',
      imageDataUrl,
      strokeData,
      duration: elapsedTime.value,
      lineCount: strokes.value.length,
    })

    ElMessage.success('繪畫已提交')
    router.push(`/dashboard/${sketch.id}`)
  } catch (e) {
    console.error('提交失敗:', e)
    ElMessage.error('提交失敗: ' + (e.message || e))
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.drawing-view {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.canvas-container {
  border: 2px solid #dcdfe6;
  border-radius: 8px;
  overflow: hidden;
  background: white;
}

.draw-canvas {
  width: 100%;
  cursor: crosshair;
  touch-action: none;
}

.drawing-info {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}
</style>
