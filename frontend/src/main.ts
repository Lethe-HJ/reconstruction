import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { PerformanceTracker } from '@/common/performance'

declare global {
  interface Window {
    tracker?: PerformanceTracker
  }
}

const tracker = new PerformanceTracker({
  group: 'web_main',
  threadId: 'web_main'
})
tracker.setSessionId(Date.now().toString())
window.tracker = tracker

async function clearAllIndexedDB () {
  try {
    if ('databases' in indexedDB) {
      const databases = await (indexedDB.databases as () => Promise<Array<{ name: string; version: number }>>)()
      for (const dbInfo of databases) {
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(dbInfo.name, dbInfo.version)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result)
          })
          const storeNames = Array.from(db.objectStoreNames)
          for (const storeName of storeNames) {
            const transaction = db.transaction([storeName], 'readwrite')
            const store = transaction.objectStore(storeName)
            await new Promise<void>((resolve, reject) => {
              const request = store.clear()
              request.onsuccess = () => resolve()
              request.onerror = () => reject(request.error)
            })
          }
          db.close()
        } catch (err) {
          console.error('[IndexedDB] 清空数据库失败:', err)
        }
      }
    } else {
      const knownDatabases = [
        { name: 'performance-trace-db', version: 1 },
        { name: 'voxel-grid-cache', version: 2 }
      ]
      for (const dbInfo of knownDatabases) {
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(dbInfo.name, dbInfo.version)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result)
          })
          const storeNames = Array.from(db.objectStoreNames)
          for (const storeName of storeNames) {
            const transaction = db.transaction([storeName], 'readwrite')
            const store = transaction.objectStore(storeName)
            await new Promise<void>((resolve, reject) => {
              const request = store.clear()
              request.onsuccess = () => resolve()
              request.onerror = () => reject(request.error)
            })
          }
          db.close()
        } catch (err) {
          console.error('[IndexedDB] 清空数据库失败:', err)
        }
      }
    }
  } catch (err) {
    console.error('[IndexedDB] 清空所有数据库失败:', err)
  }
}

if (import.meta.env.DEV) {
  await clearAllIndexedDB()
}

const app = createApp(App)
app.use(Antd)
app.use(router)
app.mount('#app')
