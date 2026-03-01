/**
 * 数据源管理器
 */

import ChunkLoaderWorker from './chunkLoader.worker.ts?worker'
import { indexedDBManager } from './indexedDB'

const SHAPE_CACHE_KEY_PREFIX = 'voxel-grid-shape_'

function getShapeCacheKey (filename: string, chunkSize: number): string {
  return `${SHAPE_CACHE_KEY_PREFIX}${filename}_${chunkSize}`
}

const THREAD_COUNT = 5

export interface PreprocessResponse {
  task_id: string
  file: string
  file_size: number
  shape: [number, number, number]
  data_length: number
  chunk_size: number
  chunks: Array<{ index: number; start: number; end: number }>
}

export interface ChunkResult {
  chunkIndex: number
  buffer: ArrayBuffer
  min: number
  max: number
  fromCache: boolean
}

export interface DataLoadResult {
  chunks: ChunkResult[]
  shape: [number, number, number]
  dataLength: number
  taskId: string | null
  allFromCache: boolean
}

export class DataSource {
  async checkAllChunksCached (
    filename: string,
    chunkSize: number,
    chunks: Array<{ index: number; start: number; end: number }>
  ): Promise<boolean> {
    const cachePromises = chunks.map((chunk) =>
      indexedDBManager.getChunk(filename, chunkSize, chunk.index)
    )
    const cacheResults = await Promise.all(cachePromises)
    return cacheResults.every((cached) => cached !== null)
  }

  async loadChunksFromCache (
    filename: string,
    chunkSize: number,
    chunks: Array<{ index: number; start: number; end: number }>
  ): Promise<ChunkResult[]> {
    const cachePromises = chunks.map(async (chunk) => {
      const cached = await indexedDBManager.getChunk(filename, chunkSize, chunk.index)
      if (!cached) throw new Error(`Chunk ${chunk.index} 缓存不存在`)
      return {
        chunkIndex: chunk.index,
        buffer: cached.buffer,
        min: cached.min,
        max: cached.max,
        fromCache: true
      }
    })
    return Promise.all(cachePromises)
  }

  async loadDataFromBackend (
    filename: string,
    chunkSize: number,
    preprocessResponse: PreprocessResponse,
    useCache: boolean = true
  ): Promise<ChunkResult[]> {
    const taskId = preprocessResponse.task_id
    const chunks = preprocessResponse.chunks

    // 先尝试从 IndexedDB 一次性取齐所有 chunk，若全部命中则直接返回，不发任何 chunk 请求
    const cacheResults = await Promise.all(
      chunks.map(async (chunk) => ({
        chunk,
        cached: useCache ? await indexedDBManager.getChunk(filename, chunkSize, chunk.index) : null
      }))
    )
    const allFromCache = cacheResults.every((item) => item?.cached != null)
    if (allFromCache) {
      return cacheResults.map((item) => ({
        chunkIndex: item!.chunk.index,
        buffer: item!.cached!.buffer,
        min: item!.cached!.min,
        max: item!.cached!.max,
        fromCache: true
      }))
    }

    const chunkLoaders: Worker[] = []
    const chunkPromises: Promise<ChunkResult>[] = []
    const activeWorkerCount = Math.min(THREAD_COUNT, chunks.length)
    let workerCounter = 0

    for (let i = 0; i < cacheResults.length; i++) {
      const item = cacheResults[i]
      if (!item) continue
      const { chunk, cached } = item
      if (cached) {
        chunkPromises.push(
          Promise.resolve({
            chunkIndex: chunk.index,
            buffer: cached.buffer,
            min: cached.min,
            max: cached.max,
            fromCache: true
          })
        )
        continue
      }
      
      const workerIndex = workerCounter % activeWorkerCount
      workerCounter++
      
      if (chunkLoaders.length <= workerIndex) {
        chunkLoaders.push(new ChunkLoaderWorker())
      }
      const worker = chunkLoaders[workerIndex]!
      const promise = new Promise<ChunkResult>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'chunk' && e.data.chunkIndex === chunk.index) {
            worker.removeEventListener('message', handler)
            resolve({
              chunkIndex: chunk.index,
              buffer: e.data.buffer,
              min: e.data.min,
              max: e.data.max,
              fromCache: false
            })
          } else if (e.data.type === 'error' && e.data.chunkIndex === chunk.index) {
            worker.removeEventListener('message', handler)
            reject(new Error(e.data.error))
          }
        }
        worker.addEventListener('message', handler)
        worker.postMessage({
          type: 'fetch-chunk',
          taskId,
          chunkIndex: chunk.index,
          start: chunk.start,
          length: chunk.end - chunk.start,
          workerIndex
        })
      })
      chunkPromises.push(promise)
    }

    const results = await Promise.all(chunkPromises)
    const closePromises = chunkLoaders.map((worker) => {
      return new Promise<void>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'close-ok') {
            worker.removeEventListener('message', handler)
            resolve()
          }
        }
        worker.addEventListener('message', handler)
        worker.postMessage({ type: 'pre-close' })
        setTimeout(() => {
          worker.removeEventListener('message', handler)
          resolve()
        }, 5000)
      })
    })
    await Promise.all(closePromises)
    chunkLoaders.forEach((w) => w.terminate())
    return results
  }

  async loadData (filename: string, chunkSize: number, useCache: boolean = true): Promise<DataLoadResult> {
    let preprocessResponse: PreprocessResponse | null = null
    let chunks: Array<{ index: number; start: number; end: number }>
    let shape: [number, number, number]
    let dataLength: number
    let taskId: string | null = null

    // 优先 localStorage，若无则从 IndexedDB 读 shape 元数据（chunk 已在 IndexedDB 时可不发 preprocess）
    const localShape = useCache ? this.getShapeFromCache(filename, chunkSize) : null
    const cachedShape = useCache ? (localShape ?? (await indexedDBManager.getShapeMeta(filename, chunkSize))) : null
    let allCached = false
    if (cachedShape) {
      chunks = cachedShape.chunks
      shape = cachedShape.shape
      dataLength = cachedShape.dataLength
      allCached = await this.checkAllChunksCached(filename, chunkSize, chunks)
    }

    let chunkResults: ChunkResult[]

    if (allCached && useCache) {
      chunkResults = await this.loadChunksFromCache(filename, chunkSize, chunks!)
    } else {
      const preprocessRes = await fetch('/api/voxel-grid/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: filename,
          chunk_size: chunkSize
        })
      })
      if (!preprocessRes.ok) {
        const errorData = await preprocessRes.json().catch(() => ({ error: `HTTP ${preprocessRes.status}` }))
        throw new Error(errorData.error ?? `预处理失败: HTTP ${preprocessRes.status}`)
      }
      preprocessResponse = await preprocessRes.json()
      if (!preprocessResponse) throw new Error('预处理响应为空')
      taskId = preprocessResponse.task_id
      chunks = preprocessResponse.chunks
      shape = preprocessResponse.shape
      dataLength = preprocessResponse.data_length
      this.saveShapeToCache(filename, chunkSize, shape, chunks, dataLength)
      indexedDBManager.saveShapeMeta(filename, chunkSize, shape, chunks, dataLength).catch(() => {})
      chunkResults = await this.loadDataFromBackend(filename, chunkSize, preprocessResponse, useCache)
    }

    chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex)
    const chunksToSave = chunkResults.filter((r) => !r.fromCache)
    if (chunksToSave.length > 0) {
      const saveChunksToCache = () => {
        chunksToSave.forEach((result) => {
          const bufferCopy = result.buffer.slice(0)
          indexedDBManager
            .saveChunk(filename, chunkSize, result.chunkIndex, bufferCopy, result.min, result.max)
            .catch((err) => console.error(`[IndexedDB] 保存 chunk ${result.chunkIndex} 失败:`, err))
        })
      }
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(saveChunksToCache, { timeout: 5000 })
      } else {
        setTimeout(saveChunksToCache, 1000)
      }
    }

    return {
      chunks: chunkResults,
      shape: shape!,
      dataLength: dataLength!,
      taskId,
      allFromCache: allCached
    }
  }

  getShapeFromCache (
    filename: string,
    chunkSize: number
  ): { shape: [number, number, number]; chunks: Array<{ index: number; start: number; end: number }>; dataLength: number } | null {
    try {
      const key = getShapeCacheKey(filename, chunkSize)
      const cached = localStorage.getItem(key)
      if (cached) return JSON.parse(cached)
    } catch (err) {
      console.warn('[DataSource] 读取 shape 缓存失败:', err)
    }
    return null
  }

  saveShapeToCache (
    filename: string,
    chunkSize: number,
    shape: [number, number, number],
    chunks: Array<{ index: number; start: number; end: number }>,
    dataLength: number
  ): void {
    try {
      const key = getShapeCacheKey(filename, chunkSize)
      localStorage.setItem(key, JSON.stringify({ shape, chunks, dataLength }))
    } catch (err) {
      console.warn('[DataSource] 保存 shape 缓存失败:', err)
    }
  }
}

export const dataSource = new DataSource()
