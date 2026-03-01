/**
 * 性能数据 IndexedDB 管理器
 */

import type { PerformanceSession, PerformanceRecord } from './types'

const DB_NAME = 'performance-trace-db'
const INITIAL_DB_VERSION = 1
const STORE_NAME_PREFIX = 'performance-session-'

function getStoreName (sessionId: string): string {
  return `${STORE_NAME_PREFIX}${sessionId}`
}

export class PerformanceDBManager {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  private pendingRecords: Map<string, PerformanceRecord[]> = new Map()
  private saveTimeout: ReturnType<typeof setTimeout> | null = null

  private async getCurrentVersion (): Promise<number> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME)
      request.onsuccess = () => {
        const version = request.result.version
        request.result.close()
        resolve(version)
      }
      request.onerror = () => resolve(0)
    })
  }

  async init (): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        const currentVersion = await this.getCurrentVersion()
        const targetVersion = currentVersion > 0 ? currentVersion : INITIAL_DB_VERSION
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, targetVersion)
          request.onerror = () => {
            const error = request.error
            if (error?.name === 'VersionError') {
              this.getCurrentVersion().then((actualVersion) => {
                if (actualVersion > 0) {
                  const retryRequest = indexedDB.open(DB_NAME, actualVersion)
                  retryRequest.onerror = () =>
                    reject(new Error(`打开 IndexedDB 失败: ${retryRequest.error}`))
                  retryRequest.onsuccess = () => {
                    this.db = retryRequest.result
                    resolve()
                  }
                } else reject(new Error(`打开 IndexedDB 失败: ${error}`))
              }).catch(() => reject(new Error(`打开 IndexedDB 失败: ${error}`)))
            } else reject(new Error(`打开 IndexedDB 失败: ${error}`))
          }
          request.onsuccess = () => {
            this.db = request.result
            resolve()
          }
          request.onupgradeneeded = () => {}
        })
      } catch (error) {
        throw new Error(`初始化 IndexedDB 失败: ${error}`)
      }
    })()
    return this.initPromise
  }

  private async ensureStore (sessionId: string): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('数据库未初始化')
    const storeName = getStoreName(sessionId)
    if (this.db.objectStoreNames.contains(storeName)) return

    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.initPromise = null
    const currentVersion = await this.getCurrentVersion()
    const newVersion = currentVersion + 1

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, newVersion)
      request.onerror = () => {
        this.initPromise = null
        reject(new Error(`打开 IndexedDB 失败: ${request.error}`))
      }
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { autoIncrement: true })
          store.createIndex('startTime', 'startTime', { unique: false })
          store.createIndex('endTime', 'endTime', { unique: false })
        }
      }
    })
  }

  async addRecord (sessionId: string, record: PerformanceRecord): Promise<void> {
    await this.init()
    if (!this.pendingRecords.has(sessionId)) {
      this.pendingRecords.set(sessionId, [])
    }
    this.pendingRecords.get(sessionId)!.push(record)
    this.scheduleSave()
  }

  async addRecords (sessionId: string, records: PerformanceRecord[]): Promise<void> {
    await this.init()
    if (!this.pendingRecords.has(sessionId)) {
      this.pendingRecords.set(sessionId, [])
    }
    this.pendingRecords.get(sessionId)!.push(...records)
    this.scheduleSave()
  }

  async completeSession (session: PerformanceSession): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('数据库未初始化')
    await this.flushPendingRecords(session.sessionId)
    await this.ensureStore(session.sessionId)
    if (!this.db) {
      await this.init()
      if (!this.db) throw new Error('数据库未初始化')
    }
    const storeName = getStoreName(session.sessionId)
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite')
      const store = transaction.objectStore(storeName)
      const sessionData = {
        sessionId: session.sessionId,
        sessionStartTime: session.sessionStartTime,
        sessionEndTime: session.sessionEndTime,
        records: session.records,
        metadata: session.metadata
      }
      const request = store.put(sessionData, 'session')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(`保存会话失败: ${request.error}`))
    })
  }

  async getSession (sessionId: string): Promise<PerformanceSession | null> {
    await this.init()
    if (!this.db) throw new Error('数据库未初始化')
    const storeName = getStoreName(sessionId)
    if (!this.db.objectStoreNames.contains(storeName)) return null
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get('session')
      request.onsuccess = () => {
        const result = request.result
        if (!result) {
          resolve(null)
          return
        }
        resolve({
          sessionId: result.sessionId,
          sessionStartTime: result.sessionStartTime,
          sessionEndTime: result.sessionEndTime,
          records: result.records ?? [],
          metadata: result.metadata
        })
      }
      request.onerror = () => reject(new Error(`获取会话失败: ${request.error}`))
    })
  }

  private scheduleSave (): void {
    if (this.saveTimeout) {
      if (typeof window !== 'undefined' && window.clearTimeout) {
        window.clearTimeout(this.saveTimeout)
      } else {
        clearTimeout(this.saveTimeout)
      }
    }
    if (typeof requestIdleCallback !== 'undefined' && typeof window !== 'undefined') {
      requestIdleCallback(() => { void this.flushPendingRecords() }, { timeout: 2000 })
    } else {
      this.saveTimeout = setTimeout(() => { void this.flushPendingRecords() }, 1000)
    }
  }

  async flushPendingRecords (sessionId?: string): Promise<void> {
    if (!this.db) return
    const sessionsToUpdate = sessionId
      ? [sessionId]
      : Array.from(this.pendingRecords.keys())
    for (const sid of sessionsToUpdate) {
      const records = this.pendingRecords.get(sid)
      if (!records || records.length === 0) continue
      let session = await this.getSession(sid)
      if (!session) {
        session = {
          sessionId: sid,
          sessionStartTime: Math.min(...records.map((r) => r.startTime)),
          sessionEndTime: Math.max(...records.map((r) => r.endTime)),
          records: []
        }
      }
      session.records.push(...records)
      session.records.sort((a, b) => a.startTime - b.startTime)
      session.sessionStartTime = Math.min(
        session.sessionStartTime,
        ...records.map((r) => r.startTime)
      )
      session.sessionEndTime = Math.max(
        session.sessionEndTime,
        ...records.map((r) => r.endTime)
      )
      await this.ensureStore(sid)
      const storeName = getStoreName(sid)
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = this.db!.transaction([storeName], 'readwrite')
          const store = transaction.objectStore(storeName)
          const sessionData = {
            sessionId: sid,
            sessionStartTime: session.sessionStartTime,
            sessionEndTime: session.sessionEndTime,
            records: session.records,
            metadata: session.metadata
          }
          const putRequest = store.put(sessionData, 'session')
          putRequest.onsuccess = () => resolve()
          putRequest.onerror = () => reject(putRequest.error)
        })
        this.pendingRecords.delete(sid)
      } catch (err) {
        console.error(`[PerformanceDB] 保存会话 ${sid} 失败:`, err)
      }
    }
  }
}

export const performanceDB = new PerformanceDBManager()
