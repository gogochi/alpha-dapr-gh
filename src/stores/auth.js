import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const DEFAULT_USER = { id: 1, name: '使用者', email: 'user@local' }

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const isAuthenticated = computed(() => !!user.value)

  function init() {
    const stored = localStorage.getItem('auth_user')
    if (stored) {
      try { user.value = JSON.parse(stored) } catch { /* fallback below */ }
    }
    if (!user.value) {
      user.value = { ...DEFAULT_USER }
      localStorage.setItem('auth_user', JSON.stringify(user.value))
    }
  }

  // Auto-init
  init()

  return { user, isAuthenticated, init }
})
