<template>
  <div id="app">
    <el-container v-if="authStore.isAuthenticated">
      <el-header class="app-header">
        <div class="header-left">
          <h2 class="app-title" @click="$router.push('/')">🎨 AlphaDAPR</h2>
          <el-menu mode="horizontal" :ellipsis="false" router>
            <el-menu-item index="/">首頁</el-menu-item>
            <el-menu-item index="/draw">繪畫</el-menu-item>
            <el-menu-item index="/sketches">草圖列表</el-menu-item>
          </el-menu>
        </div>
        <div class="header-right">
          <span class="user-name">{{ authStore.user?.name }}</span>
          <el-button type="danger" size="small" @click="handleLogout">登出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
    <router-view v-else />
  </div>
</template>

<script setup>
import { useAuthStore } from './stores/auth'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}
</script>

<style>
body { margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f5f7fa; }
.app-header { display: flex; justify-content: space-between; align-items: center; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 0 20px; }
.header-left { display: flex; align-items: center; gap: 20px; }
.header-right { display: flex; align-items: center; gap: 12px; }
.app-title { cursor: pointer; color: #409eff; margin: 0; }
.user-name { color: #606266; font-size: 14px; }
</style>
