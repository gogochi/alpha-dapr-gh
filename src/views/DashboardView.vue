<template>
  <div class="dashboard-view" v-loading="loading">
    <div class="page-header">
      <h2>📊 分析儀表板</h2>
      <el-button @click="$router.push('/sketches')">返回列表</el-button>
    </div>

    <template v-if="dashData">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-card>
            <template #header>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>🔍 素描辨識結果 (Sketch Recognition)</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 13px; color: #606266;">編輯偵測</span>
                  <el-switch v-model="editMode" />
                </div>
              </div>
            </template>
            <div class="confidence-slider">
              <span>信心閾值 (Confidence Threshold): {{ confidenceThreshold.toFixed(2) }}</span>
              <el-slider v-model="confidenceThreshold" :min="0.1" :max="1.0" :step="0.05" style="margin-top: 4px" />
            </div>
            <div class="sketch-preview">
              <canvas ref="detectionCanvas" class="detection-canvas"></canvas>
            </div>
            <div class="detection-summary" v-if="detectionSummary">
              <p>
                偵測總數: <strong>{{ detectionSummary.total }}</strong> ｜
                平均信心: <strong>{{ (detectionSummary.avgConfidence * 100).toFixed(1) }}%</strong>
              </p>
              <div class="category-tags">
                <el-tag
                  v-for="(count, cat) in detectionSummary.categoryCounts"
                  :key="cat"
                  :type="getCategoryTagType(cat)"
                  style="margin: 4px"
                >
                  {{ cat }}: {{ count }}
                </el-tag>
              </div>
            </div>
            <div v-for="det in filteredDetections" :key="det.id" style="display: inline-block;">
              <el-tag
                :type="removedIds.has(det.id) ? 'info' : getCategoryTagType(det.category)"
                style="margin: 4px"
              >
                <span :style="removedIds.has(det.id) ? 'text-decoration: line-through; opacity: 0.5;' : ''">
                  {{ det.category }} ({{ (det.confidence * 100).toFixed(0) }}%)
                </span>
                <el-button
                  v-if="editMode && det.id && !removedIds.has(det.id)"
                  type="danger"
                  size="small"
                  circle
                  style="margin-left: 4px; padding: 2px;"
                  @click="markForRemoval(det.id)"
                >✕</el-button>
                <el-button
                  v-if="editMode && removedIds.has(det.id)"
                  type="success"
                  size="small"
                  circle
                  style="margin-left: 4px; padding: 2px;"
                  @click="unmarkRemoval(det.id)"
                >↩</el-button>
              </el-tag>
            </div>
            <div v-if="editMode && removedIds.size > 0" style="margin-top: 12px;">
              <el-button type="primary" @click="saveCorrections" :loading="savingCorrections">
                儲存校正 ({{ removedIds.size }} 項移除)
              </el-button>
              <el-button @click="cancelCorrections">取消</el-button>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card>
            <template #header><span>📋 DAPR 分數表格 (Score Table)</span></template>
            <div class="score-summary" v-if="dashData.daprScore">
              <div class="score-item total">
                <span class="label">總分 (DAPR Score)</span>
                <span class="value" :class="scoreClass">{{ dashData.daprScore.totalScore }}</span>
              </div>
              <div class="score-item">
                <span class="label">資源分 (Resource)</span>
                <span class="value positive">+{{ dashData.daprScore.resourceScore }}</span>
              </div>
              <div class="score-item">
                <span class="label">壓力分 (Stress)</span>
                <span class="value negative">-{{ dashData.daprScore.stressScore }}</span>
              </div>
              <el-divider />
              <p class="formula">DAPR Score = Resource ({{ dashData.daprScore.resourceScore }}) - Stress ({{ dashData.daprScore.stressScore }}) = <strong>{{ dashData.daprScore.totalScore }}</strong></p>
              <div v-if="dashData.daprScore.interpretation" style="margin-top: 12px;">
                <el-tag type="warning" size="large">{{ dashData.daprScore.interpretation }}</el-tag>
              </div>
            </div>
            <el-empty v-else description="尚未分析">
              <el-button type="primary" @click="handleRunAnalysis" :loading="analyzing">�� 執行分析</el-button>
            </el-empty>
          </el-card>
        </el-col>
      </el-row>

      <!-- 壓力/資源屬性 -->
      <el-row :gutter="20" style="margin-top: 20px" v-if="dashData.daprScore">
        <el-col :span="12">
          <el-card>
            <template #header><span>😰 壓力相關屬性 (Stress Attributes)</span></template>
            <div v-if="stressAttrs.length">
              <div v-for="attr in stressAttrs" :key="attr.name" class="attribute-item">
                <el-tag type="danger" size="large">{{ attr.name }}</el-tag>
                <span class="attr-desc">{{ attr.description }} (得分: {{ attr.score }}/{{ attr.max_score }})</span>
              </div>
            </div>
            <el-empty v-else description="未偵測到壓力相關指標" :image-size="60" />
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card>
            <template #header><span>💪 資源相關屬性 (Resource Attributes)</span></template>
            <div v-if="resourceAttrs.length">
              <div v-for="attr in resourceAttrs" :key="attr.name" class="attribute-item">
                <el-tag type="success" size="large">{{ attr.name }}</el-tag>
                <span class="attr-desc">{{ attr.description }} (得分: {{ attr.score }}/{{ attr.max_score }})</span>
              </div>
            </div>
            <el-empty v-else description="未偵測到資源相關指標" :image-size="60" />
          </el-card>
        </el-col>
      </el-row>

      <!-- 分數分布 + 相似素描 -->
      <el-row :gutter="20" style="margin-top: 20px">
        <el-col :span="12">
          <el-card>
            <template #header><span>📈 DAPR 分數分布</span></template>
            <div ref="scoreChartRef" style="height: 300px"></div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card>
            <template #header><span>🔗 相似分數素描</span></template>
            <div v-if="dashData.similarSketches?.length" class="similar-sketches">
              <div v-for="sim in dashData.similarSketches" :key="sim.id" class="similar-item"
                @click="$router.push(`/dashboard/${sim.id}`)">
                <el-image v-if="sim.imageDataUrl" :src="sim.imageDataUrl" style="width: 100px; height: 100px" fit="contain" />
                <span>{{ sim.title }}</span>
              </div>
            </div>
            <el-empty v-else description="無相似分數素描" :image-size="60" />
          </el-card>
        </el-col>
      </el-row>

      <!-- 補充資訊 -->
      <el-divider>📝 補充資訊 (Supplementary Information)</el-divider>

      <el-row :gutter="20">
        <el-col :span="8">
          <el-card>
            <template #header><span>👤 參與者資訊</span></template>
            <el-descriptions :column="1" border v-if="dashData.participant">
              <el-descriptions-item label="年齡">{{ dashData.participant.age || '-' }}</el-descriptions-item>
              <el-descriptions-item label="性別">{{ dashData.participant.gender || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-empty v-else description="無參與者資訊" :image-size="60" />
          </el-card>
        </el-col>

        <el-col :span="8">
          <el-card>
            <template #header><span>⏱️ 繪畫時長</span></template>
            <div class="duration-display" v-if="dashData.sketch.duration">
              <div class="duration-value">{{ formatDuration(dashData.sketch.duration) }}</div>
              <div class="duration-label">繪畫總時間</div>
            </div>
            <el-empty v-else description="無時間記錄" :image-size="60" />
          </el-card>
        </el-col>

        <el-col :span="8">
          <el-card>
            <template #header><span>📏 線條統計</span></template>
            <el-descriptions :column="1" border v-if="dashData.sketch.lineCount">
              <el-descriptions-item label="線條數量">{{ dashData.sketch.lineCount }}</el-descriptions-item>
              <el-descriptions-item label="平均長度" v-if="dashData.sketch.strokeData">
                {{ (dashData.sketch.strokeData.avg_line_length || 0).toFixed(1) }}px
              </el-descriptions-item>
            </el-descriptions>
            <el-empty v-else description="無線條資料" :image-size="60" />
          </el-card>
        </el-col>
      </el-row>

      <!-- 素描回放 -->
      <el-row style="margin-top: 20px" v-if="dashData.sketch.strokeData?.strokes">
        <el-col :span="24">
          <el-card>
            <template #header>
              <div class="replay-header">
                <span>🎬 素描回放 (Sketch Replay)</span>
                <div>
                  <el-button size="small" @click="replaySketch" :disabled="isReplaying">
                    {{ isReplaying ? '播放中...' : '▶ 播放' }}
                  </el-button>
                  <el-slider v-model="replaySpeed" :min="0.5" :max="5" :step="0.5" style="width: 120px; display: inline-block; margin-left: 12px" />
                  <span style="font-size: 12px; margin-left: 4px">{{ replaySpeed }}x</span>
                </div>
              </div>
            </template>
            <canvas ref="replayCanvas" class="replay-canvas" width="800" height="600"></canvas>
          </el-card>
        </el-col>
      </el-row>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDashboardData } from '../services/db'
import { runAnalysis as runAnalysisPipeline, removeDetection as removeDetectionService, recalculateScore } from '../services/analysis'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'

const route = useRoute()
const router = useRouter()

const dashData = ref(null)
const loading = ref(true)
const analyzing = ref(false)
const detectionCanvas = ref(null)
const replayCanvas = ref(null)
const scoreChartRef = ref(null)
const isReplaying = ref(false)
const replaySpeed = ref(1)
const confidenceThreshold = ref(0.3)
const editMode = ref(false)
const removedIds = reactive(new Set())
const savingCorrections = ref(false)

const sketchId = computed(() => Number(route.params.sketchId))

const filteredDetections = computed(() => {
  if (!dashData.value?.detections) return []
  return dashData.value.detections.filter(det => det.confidence >= confidenceThreshold.value)
})

const detectionSummary = computed(() => {
  const dets = filteredDetections.value
  if (!dets.length) return null
  const total = dets.length
  const categoryCounts = {}
  let sumConf = 0
  for (const det of dets) {
    categoryCounts[det.category] = (categoryCounts[det.category] || 0) + 1
    sumConf += det.confidence
  }
  return { total, categoryCounts, avgConfidence: sumConf / total }
})

const stressAttrs = computed(() => {
  if (!dashData.value?.daprScore?.stressItems) return []
  const items = dashData.value.daprScore.stressItems
  return (Array.isArray(items) ? items : []).filter(i => i.score > 0)
})

const resourceAttrs = computed(() => {
  if (!dashData.value?.daprScore?.resourceItems) return []
  const items = dashData.value.daprScore.resourceItems
  return (Array.isArray(items) ? items : []).filter(i => i.score > 0)
})

const scoreClass = computed(() => {
  if (!dashData.value?.daprScore) return ''
  const score = dashData.value.daprScore.totalScore
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return ''
})

watch(confidenceThreshold, () => drawDetections())
watch(editMode, (val) => {
  if (!val) removedIds.clear()
  drawDetections()
})

function markForRemoval(id) { removedIds.add(id); drawDetections() }
function unmarkRemoval(id) { removedIds.delete(id); drawDetections() }
function cancelCorrections() { removedIds.clear(); editMode.value = false; drawDetections() }

async function saveCorrections() {
  if (removedIds.size === 0) return
  savingCorrections.value = true
  try {
    for (const detId of removedIds) {
      await removeDetectionService(sketchId.value, detId)
    }
    removedIds.clear()
    editMode.value = false
    await refreshDashboard()
    ElMessage.success('偵測校正已儲存，DAPR 分數已重新計算')
  } catch {
    ElMessage.error('儲存校正失敗')
  } finally {
    savingCorrections.value = false
  }
}

async function handleRunAnalysis() {
  analyzing.value = true
  try {
    await runAnalysisPipeline(sketchId.value)
    await refreshDashboard()
    ElMessage.success('分析完成')
  } catch (e) {
    console.error('分析失敗:', e)
    ElMessage.error('分析失敗: ' + (e.message || e))
  } finally {
    analyzing.value = false
  }
}

async function refreshDashboard() {
  dashData.value = await getDashboardData(sketchId.value)
  await nextTick()
  drawDetections()
  initScoreChart()
}

function getCategoryTagType(category) {
  const map = { person: 'primary', rain: 'info', umbrella: 'success', lightning: 'warning', puddle: 'danger', cloud: 'info' }
  return map[category] || 'info'
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}分${secs}秒`
}

function getConfidenceColor(confidence) {
  if (confidence > 0.8) return '#22c55e'
  if (confidence >= 0.5) return '#f59e0b'
  return '#ef4444'
}

function drawDetections() {
  const canvas = detectionCanvas.value
  if (!canvas || !dashData.value) return

  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.onload = () => {
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)

    for (const det of filteredDetections.value) {
      // bbox is [x1, y1, x2, y2]
      const [x1, y1, x2, y2] = det.bbox
      const x = x1, y = y1, w = x2 - x1, h = y2 - y1
      const isRemoved = editMode.value && det.id && removedIds.has(det.id)
      const color = isRemoved ? '#c0c4cc' : getConfidenceColor(det.confidence)
      const label = `${det.category} ${(det.confidence * 100).toFixed(0)}%`

      ctx.globalAlpha = isRemoved ? 0.3 : 1.0
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      if (det.confidence < 0.5) {
        ctx.setLineDash([5, 5])
      } else {
        ctx.setLineDash([])
      }
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])

      ctx.fillStyle = color
      ctx.font = 'bold 14px Arial'
      ctx.fillRect(x, y - 20, ctx.measureText(label).width + 8, 20)
      ctx.fillStyle = 'white'
      ctx.fillText(label, x + 4, y - 5)
      ctx.globalAlpha = 1.0
    }
  }
  img.src = dashData.value.sketch.imageDataUrl
}

function initScoreChart() {
  if (!scoreChartRef.value || !dashData.value?.scoreDistribution?.length) return

  const chart = echarts.init(scoreChartRef.value)
  const currentScore = dashData.value.daprScore?.totalScore

  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dashData.value.scoreDistribution.map(d => String(d.score)),
      name: 'DAPR Score',
    },
    yAxis: { type: 'value', name: 'Count' },
    series: [{
      type: 'bar',
      data: dashData.value.scoreDistribution.map(d => ({
        value: d.count,
        itemStyle: {
          color: (currentScore !== undefined && currentScore === d.score) ? '#F56C6C' : '#409EFF',
        },
      })),
    }],
  })
}

async function replaySketch() {
  const canvas = replayCanvas.value
  if (!canvas || !dashData.value?.sketch?.strokeData?.strokes) return

  isReplaying.value = true
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = '#333'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const strokes = dashData.value.sketch.strokeData.strokes
  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue

    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)

    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(stroke.points[i].x, stroke.points[i].y)

      const delay = (stroke.points[i].timestamp - stroke.points[i - 1].timestamp) / replaySpeed.value
      if (delay > 0 && delay < 100) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  isReplaying.value = false
}

onMounted(async () => {
  try {
    dashData.value = await getDashboardData(sketchId.value)

    if (dashData.value && !dashData.value.daprScore) {
      try {
        await runAnalysisPipeline(sketchId.value)
        dashData.value = await getDashboardData(sketchId.value)
      } catch (e) { console.error('自動分析失敗:', e) /* analysis failure doesn't block page */ }
    }

    await nextTick()
    drawDetections()
    initScoreChart()
  } catch (e) {
    ElMessage.error('載入儀表板資料失敗')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.dashboard-view { padding: 24px; max-width: 1400px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.sketch-preview { text-align: center; margin-bottom: 12px; }
.detection-canvas { max-width: 100%; max-height: 400px; border: 1px solid #ebeef5; display: block; margin: 0 auto; }
.confidence-slider { margin-bottom: 12px; font-size: 13px; color: #606266; }
.detection-summary { margin-bottom: 12px; padding: 8px 12px; background: #f5f7fa; border-radius: 6px; font-size: 13px; color: #606266; }
.detection-summary p { margin: 0 0 6px 0; }
.category-tags { display: flex; flex-wrap: wrap; }
.score-summary { text-align: center; }
.score-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
.score-item.total { font-size: 18px; font-weight: bold; }
.score-item .value.positive { color: #67C23A; }
.score-item .value.negative { color: #F56C6C; }
.formula { text-align: center; color: #606266; font-size: 14px; }
.attribute-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f5f5f5; }
.attr-desc { color: #606266; font-size: 13px; }
.similar-sketches { display: flex; gap: 12px; flex-wrap: wrap; }
.similar-item { text-align: center; cursor: pointer; padding: 8px; border-radius: 8px; transition: background 0.2s; }
.similar-item:hover { background: #f5f7fa; }
.duration-display { text-align: center; padding: 20px; }
.duration-value { font-size: 32px; font-weight: bold; color: #409EFF; }
.duration-label { color: #909399; margin-top: 8px; }
.replay-header { display: flex; justify-content: space-between; align-items: center; }
.replay-canvas { width: 100%; border: 1px solid #ebeef5; border-radius: 4px; }
</style>
