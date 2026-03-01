/**
 * IndexedDB 工具类，用于管理 chunk 数据缓存
 */

const DB_NAME = 'voxel-grid-cache'
const DB_VERSION = 3
const STORE_NAME = 'chunks'
const SHAPE_STORE_NAME = 'shape_meta'

interface ChunkCache {
  buffer: ArrayBuffer
  min: number
  max: number
  timestamp: number
}

export interface ShapeMeta {
  shape: [number, number, number]
  chunks: Array<{ index: number; start: number; end: number }>
  dataLength: number
}

class IndexedDBManager {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  private async init (): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(new Error('打开 IndexedDB 失败'))
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
          store.createIndex('file', 'file', { unique: false })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
        if (!db.objectStoreNames.contains(SHAPE_STORE_NAME)) {
          db.createObjectStore(SHAPE_STORE_NAME, { keyPath: 'key' })
        }
      }
    })
    return this.initPromise
  }

  private getCacheKey (file: string, chunkSize: number, chunkIndex: number): string {
    return `${file}_${Number(chunkSize)}_${chunkIndex}`
  }

  async getChunk (file: string, chunkSize: number, chunkIndex: number): Promise<ChunkCache | null> {
    try {
      const db = await this.init()
      const cacheKey = this.getCacheKey(file, chunkSize, chunkIndex)
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(cacheKey)
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            resolve({ buffer: result.buffer, min: result.min, max: result.max, timestamp: result.timestamp })
          } else resolve(null)
        }
        request.onerror = () => reject(new Error('读取缓存失败'))
      })
    } catch (error) {
      console.error('[IndexedDB] 获取缓存失败:', error)
      return null
    }
  }

  async saveChunk (
    file: string,
    chunkSize: number,
    chunkIndex: number,
    buffer: ArrayBuffer,
    min: number,
    max: number
  ): Promise<void> {
    try {
      const db = await this.init()
      const cacheKey = this.getCacheKey(file, chunkSize, chunkIndex)
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const data = { key: cacheKey, file, chunkSize, chunkIndex, buffer, min, max, timestamp: Date.now() }
        const request = store.put(data)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('保存缓存失败'))
      })
    } catch (error) {
      console.error('[IndexedDB] 保存缓存失败:', error)
    }
  }

  private getShapeMetaKey (file: string, chunkSize: number): string {
    return `shape_${file}_${Number(chunkSize)}`
  }

  async getShapeMeta (file: string, chunkSize: number): Promise<ShapeMeta | null> {
    try {
      const db = await this.init()
      const key = this.getShapeMetaKey(file, chunkSize)
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SHAPE_STORE_NAME], 'readonly')
        const store = transaction.objectStore(SHAPE_STORE_NAME)
        const request = store.get(key)
        request.onsuccess = () => {
          const result = request.result
          if (result?.shape && result?.chunks != null && result?.dataLength != null) {
            resolve({
              shape: result.shape,
              chunks: result.chunks,
              dataLength: result.dataLength
            })
          } else {
            resolve(null)
          }
        }
        request.onerror = () => reject(new Error('读取 shape 元数据失败'))
      })
    } catch (error) {
      console.warn('[IndexedDB] 读取 shape 元数据失败:', error)
      return null
    }
  }

  async saveShapeMeta (
    file: string,
    chunkSize: number,
    shape: [number, number, number],
    chunks: Array<{ index: number; start: number; end: number }>,
    dataLength: number
  ): Promise<void> {
    try {
      const db = await this.init()
      const key = this.getShapeMetaKey(file, chunkSize)
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SHAPE_STORE_NAME], 'readwrite')
        const store = transaction.objectStore(SHAPE_STORE_NAME)
        const data = { key, file, chunkSize, shape, chunks, dataLength }
        const request = store.put(data)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(new Error('保存 shape 元数据失败'))
      })
    } catch (error) {
      console.warn('[IndexedDB] 保存 shape 元数据失败:', error)
    }
  }
}

export const indexedDBManager = new IndexedDBManager()
