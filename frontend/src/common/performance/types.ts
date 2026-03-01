/**
 * 性能分析数据类型定义
 */

export interface PerformanceRecord {
  startTime: number
  endTime: number
  channelGroup: string
  channelIndex: number | string
  msg: string
}

export interface PerformanceSession {
  sessionId: string
  sessionStartTime: number
  sessionEndTime: number
  records: PerformanceRecord[]
  metadata?: {
    filename?: string
    chunkSize?: number
    taskId?: string
    [key: string]: unknown
  }
}

export interface ChannelGroupConfig {
  name: string
  displayName: string
  color: string
  order: number
}

export interface PerformanceTrackerConfig {
  group: string
  threadId: string
  sessionId?: string
  metadata?: PerformanceSession['metadata']
}
