<template>
  <div class="home-view">
    <el-row :gutter="20">
      <el-col :span="8">
        <el-card class="stat-card" shadow="hover" @click="$router.push('/sketches')">
          <el-statistic title="素描總數" :value="stats.totalSketches" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card" shadow="hover">
          <el-statistic title="已分析" :value="stats.analyzedSketches" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card" shadow="hover">
          <el-statistic title="平均 DAPR 分數" :value="stats.avgScore" :precision="1" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 24px">
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>快速操作</span>
            </div>
          </template>
          <div class="quick-actions">
            <el-button type="primary" size="large" @click="$router.push('/draw')">
              ✏️ 開始繪畫
            </el-button>
            <el-upload
              :show-file-list="false"
              :before-upload="handleUpload"
              accept="image/*"
            >
              <el-button type="success" size="large">📁 上傳素描</el-button>
            </el-upload>
            <el-button type="info" size="large" @click="$router.push('/sketches')">
              📋 查看素描列表
            </el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>⚠️ 系統說明</span>
            </div>
          </template>
          <el-alert
            title="AI 輔助工具聲明"
            type="info"
            :closable="false"
            show-icon
          >
            <p>AlphaDAPR 是一個 <strong>輔助工具</strong>，旨在協助藝術治療師進行大規模繪畫評估。</p>
            <p>AI 分析結果僅供參考，<strong>最終的評估決定應由專業治療師做出</strong>。</p>
            <p>系統透過可解釋的 AI 提供透明的分析過程，幫助您更有效率地完成工作。</p>
          </el-alert>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getStats, createSketch } from '../services/db'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const stats = ref({ totalSketches: 0, analyzedSketches: 0, avgScore: 0 })

onMounted(async () => {
  if (authStore.user) {
    stats.value = await getStats(authStore.user.id)
  }
})

async function handleUpload(file) {
  try {
    const dataUrl = await fileToDataUrl(file)
    const sketch = await createSketch(authStore.user.id, {
      title: file.name || '上傳的素描',
      imageDataUrl: dataUrl,
    })
    ElMessage.success('素描上傳成功')
    router.push(`/dashboard/${sketch.id}`)
  } catch {
    ElMessage.error('上傳失敗')
  }
  return false
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
</script>

<style scoped>
.home-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.stat-card {
  cursor: pointer;
  text-align: center;
}

.quick-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
