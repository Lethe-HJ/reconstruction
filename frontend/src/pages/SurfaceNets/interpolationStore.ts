/**
 * 插值结果获取类：一级 lastStoreRes，二级 IndexedDB，未命中时由本类调用插值 Worker；
 * 结果先覆盖 lastStoreRes，再在 requestIdleCallback 时写入 IndexedDB。
 */

import { indexedDBManager } from "./indexedDB"
import InterpolationWorker from "./interpolation.worker.ts?worker"

export type Shape3 = [number, number, number]

interface LastStoreRes {
  key: string
  data: Float64Array
  shape: Shape3
}

function cacheKey (
  taskId: string,
  shape: Shape3,
  smooth: number
): string {
  return `interpolation_${taskId}_${shape.join(",")}_${smooth}`
}

let lastStoreRes: LastStoreRes | null = null
let interpolationWorker: Worker | null = null
let pendingGet: {
  resolve: (value: { data: Float64Array; shape: Shape3 }) => void
  reject: (reason: Error) => void
  key: string
} | null = null
let idleCallbackId: number | null = null

function scheduleIdleWrite (
  key: string,
  buffer: ArrayBuffer,
  shape: Shape3
): void {
  if (idleCallbackId != null && typeof cancelIdleCallback === "function") {
    cancelIdleCallback(idleCallbackId)
  }
  const schedule = (): void => {
    indexedDBManager.saveInterpolation(key, buffer, shape).catch((err) => {
      console.warn("[InterpolationStore] requestIdleCallback 写 IDB 失败:", err)
    })
  }
  if (typeof requestIdleCallback === "function") {
    idleCallbackId = requestIdleCallback(schedule, { timeout: 2000 })
  } else {
    setTimeout(schedule, 0)
  }
}

function getWorker (): Worker {
  if (!interpolationWorker) {
    interpolationWorker = new InterpolationWorker()
    interpolationWorker.onmessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg.type === "interpolateResult" && pendingGet) {
        const data = new Float64Array(msg.data)
        const shape = msg.shape as Shape3
        const key = pendingGet.key
        lastStoreRes = { key, data, shape }
        scheduleIdleWrite(key, data.buffer, shape)
        pendingGet.resolve({ data, shape })
        pendingGet = null
      } else if (msg.type === "interpolateError" && pendingGet) {
        pendingGet.reject(new Error(msg.error ?? "插值计算失败"))
        pendingGet = null
      }
    }
  }
  return interpolationWorker
}

export interface GetOptions {
  dataBuffer: ArrayBuffer
  computeEnv: "js" | "rust"
}

/**
 * 取插值结果：L1 lastStoreRes → L2 IndexedDB → 都未命中时由本类调用插值 Worker 并返回 Promise。
 */
export function get (
  taskId: string,
  shape: Shape3,
  smoothLevel: number,
  options?: GetOptions
): Promise<{ data: Float64Array; shape: Shape3 }> {
  const key = cacheKey(taskId, shape, smoothLevel)

  if (lastStoreRes != null && lastStoreRes.key === key) {
    return Promise.resolve({
      data: lastStoreRes.data,
      shape: lastStoreRes.shape,
    })
  }

  return (async () => {
    const idbResult = await indexedDBManager.getInterpolation(key)
    if (idbResult != null) {
      const data = new Float64Array(idbResult.buffer)
      lastStoreRes = { key, data, shape: idbResult.shape }
      return { data, shape: idbResult.shape }
    }

    if (options == null) {
      throw new Error("插值缓存未命中且未提供 dataBuffer/computeEnv")
    }

    return new Promise<{ data: Float64Array; shape: Shape3 }>((resolve, reject) => {
      pendingGet = { resolve, reject, key }
      const worker = getWorker()
      worker.postMessage(
        {
          type: "interpolate",
          dataBuffer: options.dataBuffer,
          shape,
          smoothLevel,
          computeEnv: options.computeEnv,
        },
        [options.dataBuffer]
      )
    })
  })()
}
