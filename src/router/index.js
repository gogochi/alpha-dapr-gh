import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'Home', component: () => import('../views/HomeView.vue') },
  { path: '/sketches', name: 'Sketches', component: () => import('../views/SketchListView.vue') },
  { path: '/dashboard/:sketchId', name: 'Dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/draw', name: 'Draw', component: () => import('../views/DrawingView.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
