import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createUser, findUserByEmail, verifyPassword } from '../services/db'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const isAuthenticated = computed(() => !!user.value)

  // On init, restore from localStorage
  function init() {
    const stored = localStorage.getItem('auth_user')
    if (stored) {
      try { user.value = JSON.parse(stored) } catch { user.value = null }
    }
  }

  async function register(name, email, password) {
    const existing = await findUserByEmail(email)
    if (existing) throw new Error('此信箱已被註冊')

    const newUser = await createUser(name, email, password)
    user.value = { id: newUser.id, name: newUser.name, email: newUser.email }
    localStorage.setItem('auth_user', JSON.stringify(user.value))
    return user.value
  }

  async function login(email, password) {
    const dbUser = await verifyPassword(email, password)
    if (!dbUser) throw new Error('信箱或密碼錯誤')

    user.value = { id: dbUser.id, name: dbUser.name, email: dbUser.email }
    localStorage.setItem('auth_user', JSON.stringify(user.value))
    return user.value
  }

  function logout() {
    user.value = null
    localStorage.removeItem('auth_user')
  }

  // Auto-init
  init()

  return { user, isAuthenticated, register, login, logout, init }
})
