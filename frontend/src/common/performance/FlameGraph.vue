<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import type { PerformanceSession, PerformanceRecord, ChannelGroupConfig } from './types'
import { CHANNEL_GROUPS } from './tracker'

const props = defineProps<{
  session: PerformanceSession | null
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null
let resizeHandler: (() => void) | null = null

const chartData = computed(() => {
  const session = props.session
  if (!session?.records?.length) return null

  let sessionStartTime = session.sessionStartTime
  let sessionEndTime = session.sessionEndTime
  if (isNaN(sessionStartTime) || isNaN(sessionEndTime) || !isFinite(sessionStartTime) || !isFinite(sessionEndTime)) {
    const allTimes = session.records
      .flatMap((r) => [r.startTime, r.endTime])
      .filter((t) => typeof t === 'number' && !isNaN(t) && isFinite(t))
    if (allTimes.length > 0) {
      sessionStartTime = Math.min(...allTimes)
      sessionEndTime = Math.max(...allTimes)
    } else return null
  }

  const totalDuration = sessionEndTime - sessionStartTime
  const maxTime = totalDuration / 1000
  if (!isFinite(maxTime) || maxTime <= 0) return null

  const groupsMap: Record<string, Map<string, PerformanceRecord[]>> = {}
  session.records.forEach((record) => {
    if (!record.channelGroup) return
    const g = record.channelGroup
    if (!groupsMap[g]) groupsMap[g] = new Map()
    const indexKey = String(record.channelIndex)
    if (!groupsMap[g].has(indexKey)) groupsMap[g].set(indexKey, [])
    groupsMap[g].get(indexKey)!.push(record)
  })

  const channelLayers: Record<string, Map<string, PerformanceRecord[][]>> = {}
  Object.keys(groupsMap).forEach((groupName) => {
    channelLayers[groupName] = new Map()
    const indexMap = groupsMap[groupName]!
    indexMap.forEach((records, indexKey) => {
      const layers: PerformanceRecord[][] = []
      const sortedRecords = [...records].sort((a, b) => a.startTime - b.startTime)
      sortedRecords.forEach((record) => {
        let placed = false
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
          const layer = layers[layerIndex]!
          const canPlace = layer.every(
            (existing) =>
              existing.endTime <= record.startTime || existing.startTime >= record.endTime
          )
          if (canPlace) {
            layer.push(record)
            placed = true
            break
          }
        }
        if (!placed) layers.push([record])
      })
      channelLayers[groupName]!.set(indexKey, layers)
    })
  })

  const series: echarts.SeriesOption[] = []
  const yAxisData: string[] = []
  const allGroupNames = Object.keys(channelLayers)
  const configuredGroups = new Set(Object.keys(CHANNEL_GROUPS))
  const defaultColorPalette = [
    '#4a90e2', '#f5a623', '#50e3c2', '#7aa2f7', '#bb9af7',
    '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#a9b1d6'
  ]
  let defaultOrder = 100

  function processGroup (
    _groupName: string,
    groupConfig: ChannelGroupConfig,
    layers: Map<string, PerformanceRecord[][]>
  ) {
    const sortedIndexes = Array.from(layers.keys()).sort((a, b) => {
      const numA = Number(a)
      const numB = Number(b)
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB
      return a.localeCompare(b)
    })
    sortedIndexes.forEach((indexKey) => {
      const recordLayers = layers.get(indexKey)!
      const channelIndex = indexKey
      recordLayers.forEach((layer, layerIndex) => {
        const yIndex = yAxisData.length
        const isNumeric = !isNaN(Number(channelIndex))
        const displayName = layerIndex === 0
          ? `${groupConfig.displayName}${isNumeric && Number(channelIndex) !== 0 ? ` [${channelIndex}]` : !isNumeric ? ` [${channelIndex}]` : ''}`
          : ''
        yAxisData.push(displayName)
        const data = layer.map((record) => ({
          value: [
            (record.startTime - sessionStartTime) / 1000,
            yIndex,
            (record.endTime - sessionStartTime) / 1000
          ],
          name: record.msg,
          record
        }))
        series.push({
          type: 'custom',
          name: layerIndex === 0 ? displayName || groupConfig.displayName : '',
          data,
          renderItem: (_params: unknown, api: unknown) => {
            const apiVal = api as { value: (i: number) => number; coord: (v: number[]) => number[]; size?: (v: number[]) => number | number[]; style: (opts: object) => object }
            const startTime = apiVal.value(0)
            const categoryIndex = apiVal.value(1)
            const endTime = apiVal.value(2)
            const start = apiVal.coord([startTime, categoryIndex])
            const end = apiVal.coord([endTime, categoryIndex])
            const size = apiVal.size?.([0, 1])
            const categoryHeight = (size !== undefined ? (Array.isArray(size) ? size[1] : size) : 20) ?? 20
            const barHeight = (categoryHeight * 0.7) / 3
            const width = Math.max(end[0]! - start[0]!, 2)
            return {
              type: 'rect',
              shape: { x: start[0]!, y: start[1]! - barHeight / 2, width, height: barHeight },
              style: apiVal.style({
                fill: groupConfig.color as string,
                opacity: 0.85,
                stroke: 'rgba(0, 0, 0, 0.15)',
                lineWidth: 1
              }),
              emphasis: {
                style: { opacity: 1, shadowBlur: 8, shadowColor: 'rgba(0, 0, 0, 0.25)' }
              }
            }
          }
        })
      })
    })
  }

  Object.values(CHANNEL_GROUPS).sort((a, b) => a.order - b.order).forEach((groupConfig) => {
    const layers = channelLayers[groupConfig.name]
    if (layers?.size) processGroup(groupConfig.name, groupConfig, layers)
  })
  allGroupNames.forEach((groupNameUnused) => {
    if (!configuredGroups.has(groupNameUnused)) {
      const layers = channelLayers[groupNameUnused]
      if (!layers?.size) return
      const defaultConfig: ChannelGroupConfig = {
        name: groupNameUnused,
        displayName: groupNameUnused,
        color: defaultColorPalette[defaultOrder % defaultColorPalette.length] ?? '#4a90e2',
        order: defaultOrder++
      }
      processGroup(groupNameUnused, defaultConfig, layers)
    }
  })

  if (series.length === 0) return null
  return { maxTime, totalDuration, series, yAxisData }
})

function initChart () {
  if (!chartRef.value || !chartData.value) return
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  chartInstance = echarts.init(chartRef.value)
  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { data?: { record?: PerformanceRecord } }
        if (!p?.data?.record) return ''
        const record = p.data.record
        const durationSec = ((record.endTime - record.startTime) / 1000).toFixed(3)
        let html = `<div style="font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px;">${record.msg}</div>`
        html += `<div style="line-height: 1.6;">`
        html += `<div>开始: ${new Date(record.startTime).toISOString()}</div>`
        html += `<div>结束: ${new Date(record.endTime).toISOString()}</div>`
        html += `<div>持续时间: ${durationSec}s</div>`
        html += `<div>行组: ${record.channelGroup}</div><div>行号: ${record.channelIndex}</div></div>`
        return html
      },
    backgroundColor: 'rgba(0, 0, 0, 0.85)' as const,
    borderColor: 'transparent' as const,
    textStyle: { color: '#fff', fontSize: 12 },
    extraCssText: 'max-width: 300px;'
  },
    grid: { left: 120, right: 40, top: 20, bottom: 80, containLabel: false },
    xAxis: {
      type: 'value',
      name: '时间 (秒)',
      nameLocation: 'middle',
      nameGap: 30,
      min: 0,
      max: chartData.value.maxTime,
      axisLabel: { formatter: (value: number) => `${value.toFixed(1)}s` },
      splitLine: { show: true, lineStyle: { type: 'dashed', opacity: 0.3 } }
    },
    yAxis: {
      type: 'category',
      data: chartData.value.yAxisData,
      inverse: true,
      axisLabel: {
        fontSize: 11,
        fontWeight: 'bold' as const,
        color: (value?: string | number) => {
          const v = String(value ?? '')
          for (const groupConfig of Object.values(CHANNEL_GROUPS)) {
            if (v.includes(groupConfig.displayName)) return groupConfig.color
          }
          return '#666'
        }
      },
      axisLine: { show: true, lineStyle: { color: '#e8e8e8' } },
      splitLine: { show: true, lineStyle: { color: '#f0f0f0' } },
      boundaryGap: false
    },
    dataZoom: [
      { type: 'slider', show: true, xAxisIndex: 0, start: 0, end: 100, height: 20, bottom: 10, handleSize: '80%', handleStyle: { color: '#4a90e2' }, textStyle: { color: '#666', fontSize: 11 } },
      { type: 'inside', xAxisIndex: 0, start: 0, end: 100 }
    ],
    series: chartData.value.series,
    animation: false
  }
  chartInstance.setOption(option)
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  resizeHandler = () => chartInstance?.resize()
  window.addEventListener('resize', resizeHandler)
}

onUnmounted(() => {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  chartInstance?.dispose()
  chartInstance = null
})

watch([chartRef, chartData], () => initChart(), { flush: 'post' })

const totalDurationText = computed(() => {
  const s = props.session
  if (!s?.records?.length) return '0.00'
  let total = (s.sessionEndTime - s.sessionStartTime) / 1000
  if (isNaN(total) || !isFinite(total)) {
    const allTimes = s.records.flatMap((r) => [r.startTime, r.endTime]).filter((t) => typeof t === 'number' && !isNaN(t) && isFinite(t))
    if (allTimes.length > 0) total = (Math.max(...allTimes) - Math.min(...allTimes)) / 1000
    else total = 0
  }
  return total.toFixed(2)
})
</script>

<template>
  <a-card v-if="!session || !session.records?.length" title="性能时间轴（火焰图）" size="small">
    <div style="padding: 20px; text-align: center; color: #999">
      <template v-if="!session">
        <div style="margin-bottom: 8px">⚠️ 未找到性能数据</div>
        <div style="font-size: 12px; color: #666">请确保已完成一次数据加载操作</div>
      </template>
      <template v-else>
        <div style="margin-bottom: 8px">📊 暂无性能记录</div>
        <div style="font-size: 12px; color: #666">会话 ID: {{ session.sessionId }}</div>
      </template>
    </div>
  </a-card>
  <a-card v-else title="性能时间轴（火焰图）" size="small">
    <template #extra>
      <span style="font-size: 12px; color: #666">总耗时: {{ totalDurationText }}s</span>
    </template>
    <div style="position: relative">
      <div
        style="margin-bottom: 10px; padding: 8px; background: #f5f5f5; border-radius: 4px; display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px"
      >
        <div
          v-for="config in Object.values(CHANNEL_GROUPS)"
          :key="config.name"
          style="display: flex; align-items: center; gap: 6px"
        >
          <div
            :style="{ width: 14, height: 14, backgroundColor: config.color, borderRadius: 2 }"
          />
          <span>{{ config.displayName }}</span>
        </div>
      </div>
      <div
        ref="chartRef"
        :style="{
          width: '100%',
          height: Math.max(300, (chartData?.yAxisData?.length ?? 0) * 20) + 'px',
          minHeight: '300px'
        }"
      />
      <div style="margin-top: 10px; font-size: 11px; color: #999; text-align: center">
        💡 提示: 使用底部滚动条或 Ctrl/Cmd + 滚轮缩放，鼠标悬停查看详细信息
      </div>
    </div>
  </a-card>
</template>
