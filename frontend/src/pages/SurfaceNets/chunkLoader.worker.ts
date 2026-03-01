/// <reference lib="webworker" />

declare const __DEV__: boolean

type ChunkRequestMessage =
  | {
      type: 'fetch-chunk'
      taskId: string
      chunkIndex: number
      start: number
      length: number
    }
  | { type: 'pre-close' }

const ctx = self as unknown as DedicatedWorkerGlobalScope

self.addEventListener('message', async (event: MessageEvent<ChunkRequestMessage>) => {
  if (event.data.type === 'pre-close') {
    ctx.postMessage({ type: 'close-ok' })
    return
  }
  if (event.data.type !== 'fetch-chunk') return
  const { taskId, chunkIndex, start, length } = event.data
  const url = `/api/voxel-grid/chunk?task_id=${encodeURIComponent(taskId)}&chunk_index=${chunkIndex}`
  try {
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
