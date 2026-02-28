<template>
  <div class="sketch-list-view">
    <div class="page-header">
      <h2>素描列表</h2>
      <div>
        <el-button type="primary" @click="$router.push('/draw')">✏️ 開始繪畫</el-button>
      </div>
    </div>

    <el-table :data="sketches" stripe style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="預覽" width="120">
        <template #default="{ row }">
          <el-image
            v-if="row.imageDataUrl"
            :src="row.imageDataUrl"
            style="width: 80px; height: 80px"
            fit="contain"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="標題">
        <template #default="{ row }">
          {{ row.title || 'Untitled' }}
        </template>
      </el-table-column>
      <el-table-column label="繪畫時長" width="120">
        <template #default="{ row }">
          {{ row.duration ? `${row.duration.toFixed(1)}s` : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="線條數" width="100">
        <template #default="{ row }">
          {{ row.lineCount || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="已分析" width="80">
        <template #default="{ row }">
          <el-tag :type="row.analyzed ? 'success' : 'info'" size="small">
            {{ row.analyzed ? '✓' : '✗' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="建立時間">
        <template #default="{ row }">
          {{ new Date(row.createdAt).toLocaleString('zh-TW') }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300">
        <template #default="{ row }">
          <el-button size="small" @click="handleAnalyze(row.id)" :loading="analyzing === row.id">
            🔍 分析
          </el-button>
          <el-button size="small" type="primary" @click="$router.push(`/dashboard/${row.id}`)">
            📊 儀表板
          </el-button>
          <el-popconfirm title="確定要刪除此素描嗎？" @confirm="handleDelete(row.id)">
            <template #reference>
              <el-button size="small" type="danger">🗑️ 刪除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && sketches.length === 0" description="尚無素描，開始繪畫或上傳吧！" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { getSketchesByUser, deleteSketch } from '../services/db'
import { runAnalysis } from '../services/analysis'
import { ElMessage } from 'element-plus'

const authStore = useAuthStore()
const sketches = ref([])
const loading = ref(false)
const analyzing = ref(null)

async function loadSketches() {
  loading.value = true
  try {
    sketches.value = await getSketchesByUser(authStore.user.id)
  } catch {
    ElMessage.error('載入素描列表失敗')
  } finally {
    loading.value = false
  }
}

onMounted(loadSketches)

async function handleAnalyze(sketchId) {
  analyzing.value = sketchId
  try {
    await runAnalysis(sketchId)
    ElMessage.success('分析完成')
    await loadSketches()
  } catch {
    ElMessage.error('分析失敗')
  } finally {
    analyzing.value = null
  }
}

async function handleDelete(sketchId) {
  try {
    await deleteSketch(sketchId)
    ElMessage.success('已刪除')
    await loadSketches()
  } catch {
    ElMessage.error('刪除失敗')
  }
}
</script>

<style scoped>
.sketch-list-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
</style>
