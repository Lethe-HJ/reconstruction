/**
 * Worker 端性能记录工具
 */

import type { PerformanceRecord } from './types'

export async function recordPerformanceInWorker (
  sessionId: string,
  record: PerformanceRecord
): Promise<void> {
  try {
    const dbName = 'performance-trace-db'
    const storeName = 'performance-sessions'
    const version = 1
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, version)
      request.onerror = () => reject(new Error(`打开 IndexedDB 失败: ${request.error}`))
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction([storeName], 'readwrite')
        const store = transaction.objectStore(storeName)
        const getRequest = store.get(sessionId)
        getRequest.onsuccess = () => {
          let session = getRequest.result
          if (!session) {
            session = {
              sessionId,
              sessionStartTime: record.startTime,
              sessionEndTime: record.endTime,
              records: []
            }
          } else {
            session.sessionStartTime = Math.min(session.sessionStartTime, record.startTime)
            session.sessionEndTime = Math.max(session.sessionEndTime, record.endTime)
          }
          session.records.push(record)
          session.records.sort((a: PerformanceRecord, b: PerformanceRecord) => a.startTime - b.startTime)
          const putRequest = store.put(session)
          putRequest.onsuccess = () => resolve()
          putRequest.onerror = () => reject(new Error(`保存会话失败: ${putRequest.error}`))
        }
        getRequest.onerror = () => reject(new Error(`获取会话失败: ${getRequest.error}`))
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(storeName)) {
          const s = db.createObjectStore(storeName, { keyPath: 'sessionId' })
          s.createIndex('sessionId', 'sessionId', { unique: true })
          s.createIndex('startTime', 'sessionStartTime', { unique: false })
        }
      }
    })
  } catch (err) {
    console.error('[Worker Performance] 记录性能数据失败:', err)
    throw err
  }
}

export async function recordBatchPerformanceInWorker (
  sessionId: string,
  records: PerformanceRecord[]
): Promise<void> {
  for (const record of records) {
    try {
      await recordPerformanceInWorker(sessionId, record)
    } catch (err) {
      console.error('[Worker Performance] 批量记录失败:', err)
    }
  }
}
