/// <reference lib="webworker" />

declare const __DEV__: boolean

import { PerformanceTracker } from '@/common/performance/tracker'

const threadId = crypto.randomUUID().slice(0, 8)
const tracker = new PerformanceTracker({ group: 'worker', threadId })

type ChunkRequestMessage =
  | {
      type: 'fetch-chunk'
      taskId: string
      chunkIndex: number
      start: number
      length: number
      sessionId: string
    }
  | { type: 'pre-close' }

const ctx = self as unknown as DedicatedWorkerGlobalScope

self.addEventListener('message', async (event: MessageEvent<ChunkRequestMessage>) => {
  if (event.data.type === 'pre-close') {
    try {
      await tracker.complete()
      ctx.postMessage({ type: 'close-ok' })
    } catch (err) {
      console.error('[Worker] tracker.complete() 失败:', err)
      ctx.postMessage({ type: 'close-ok' })
    }
    return
  }
  if (event.data.type !== 'fetch-chunk') return
  const { taskId, chunkIndex, start, length, sessionId } = event.data
  tracker.setSessionId(sessionId)
  const url = `/api/voxel-grid/chunk?task_id=${encodeURIComponent(taskId)}&chunk_index=${chunkIndex}`
  try {
    const eventId = `fetch_chunk_${chunkIndex}`
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      tracker.startRecord(eventId, `Worker 请求 Chunk ${chunkIndex}`)
    }
    let response: Response
    let retryCount = 0
    const maxRetries = 10
    const baseDelay = 100
    while (true) {
      response = await fetch(url)
      if (response.status === 200) break
      if (response.status === 202) {
        if (retryCount >= maxRetries) {
          throw new Error(`chunk ${chunkIndex} 在 ${maxRetries} 次重试后仍未就绪`)
        }
        const delay = baseDelay * Math.pow(2, retryCount)
        await new Promise((resolve) => setTimeout(resolve, delay))
        retryCount++
        continue
      }
      const message = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      throw new Error(message.error ?? `HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    if (typeof __DEV__ !== 'undefined' && __DEV__) tracker.endRecord(eventId)

    const parseEventId = `parse_chunk_${chunkIndex}`
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      tracker.startRecord(parseEventId, `Worker 解析 Chunk ${chunkIndex} 数据`)
    }
    const data = new Float64Array(buffer)
    const first = data[0]
    let minVal = typeof first === 'number' ? first : 0
    let maxVal = typeof first === 'number' ? first : 0
    for (let i = 1; i < data.length; i++) {
      const v = data[i]
      if (typeof v === 'number') {
        if (v < minVal) minVal = v
        if (v > maxVal) maxVal = v
      }
    }
    tracker.endRecord(parseEventId)

    ctx.postMessage(
      { type: 'chunk', chunkIndex, start, length, buffer, min: minVal, max: maxVal },
      [buffer]
    )
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      chunkIndex,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
