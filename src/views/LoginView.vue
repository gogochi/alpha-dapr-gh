<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="card-header">
          <h2>🎨 AlphaDAPR</h2>
          <p>AI-based Expert Support System for Art Therapy</p>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="登入" name="login">
          <el-form @submit.prevent="handleLogin" :model="loginForm">
            <el-form-item label="Email">
              <el-input v-model="loginForm.email" type="email" placeholder="your@email.com" />
            </el-form-item>
            <el-form-item label="密碼">
              <el-input v-model="loginForm.password" type="password" placeholder="密碼" show-password />
            </el-form-item>
            <el-button type="primary" @click="handleLogin" :loading="loading" style="width: 100%">
              登入
            </el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="註冊" name="register">
          <el-form @submit.prevent="handleRegister" :model="registerForm">
            <el-form-item label="姓名">
              <el-input v-model="registerForm.name" placeholder="您的姓名" />
            </el-form-item>
            <el-form-item label="Email">
              <el-input v-model="registerForm.email" type="email" placeholder="your@email.com" />
            </el-form-item>
            <el-form-item label="密碼">
              <el-input v-model="registerForm.password" type="password" placeholder="至少6字元" show-password />
            </el-form-item>
            <el-button type="primary" @click="handleRegister" :loading="loading" style="width: 100%">
              註冊
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error = ''" style="margin-top: 16px" />
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const activeTab = ref('login')
const loading = ref(false)
const error = ref('')

const loginForm = ref({ email: '', password: '' })
const registerForm = ref({ name: '', email: '', password: '' })

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    await authStore.login(loginForm.value.email, loginForm.value.password)
    router.push('/')
  } catch (e) {
    error.value = e.message || '登入失敗'
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  loading.value = true
  error.value = ''
  try {
    await authStore.register(registerForm.value.name, registerForm.value.email, registerForm.value.password)
    router.push('/')
  } catch (e) {
    error.value = e.message || '註冊失敗'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  width: 420px;
}

.card-header {
  text-align: center;
}

.card-header h2 {
  margin-bottom: 4px;
}

.card-header p {
  color: #909399;
  font-size: 13px;
}
</style>
