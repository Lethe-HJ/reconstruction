/**
 * 后端响应头性能数据解析
 */

import type { PerformanceRecord } from './types'
import { recordPerformanceInWorker } from './worker-utils'

export function parsePerformanceFromHeaders (
  headers: Headers,
  _sessionId: string
): PerformanceRecord[] {
  const records: PerformanceRecord[] = []
  const perfHeader = headers.get('X-Performance-Data')
  if (!perfHeader) return records
  const perfDataList = perfHeader.split(';').filter(Boolean)
  for (const perfData of perfDataList) {
    try {
      const parts = perfData.trim().split(',')
      if (parts.length < 5) continue
      const startTime = parseInt(parts[0] ?? '0', 10)
      const endTime = parseInt(parts[1] ?? '0', 10)
      const channelGroup = parts[2] ?? ''
      const channelIndex = parseInt(parts[3] ?? '0', 10)
      const msg = parts.slice(4).join(',')
      if (isNaN(startTime) || isNaN(endTime) || isNaN(channelIndex)) continue
      records.push({ startTime, endTime, channelGroup, channelIndex, msg })
    } catch (err) {
      console.error('[Performance] 解析性能数据失败:', err, perfData)
    }
  }
  return records
}

export async function recordPerformanceFromResponse (
  response: Response,
  sessionId: string
): Promise<void> {
  const records = parsePerformanceFromHeaders(response.headers, sessionId)
  if (records.length === 0) return
  if (typeof self !== 'undefined' && 'importScripts' in self) {
    for (const record of records) {
      await recordPerformanceInWorker(sessionId, record).catch((err) => {
        console.error('[Performance] Worker 记录性能数据失败:', err)
      })
    }
  } else {
    const { performanceDB } = await import('./indexedDB')
    await performanceDB.init()
    await performanceDB.addRecords(sessionId, records).catch((err) => {
      console.error('[Performance] 主线程记录性能数据失败:', err)
    })
  }
}
