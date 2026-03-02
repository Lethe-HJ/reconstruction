import { createRouter, createWebHistory } from 'vue-router'
import SurfaceNetsDemo from '@/pages/SurfaceNets/SurfaceNets.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/surface-nets', name: 'SurfaceNets', component: SurfaceNetsDemo }
  ]
})

export default router
