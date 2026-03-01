import { createRouter, createWebHistory } from 'vue-router'
import LayoutPage from '@/layout/Index.vue'
import Home from '@/pages/Home/Index.vue'
import SurfaceNetsDemo from '@/pages/SurfaceNets/SurfaceNets.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: LayoutPage,
      children: [
        { path: '', name: 'Home', component: Home },
        { path: 'surface-nets', name: 'SurfaceNets', component: SurfaceNetsDemo }
      ]
    }
  ]
})

export default router
