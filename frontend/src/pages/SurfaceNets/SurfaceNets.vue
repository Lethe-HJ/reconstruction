<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import VoxelGridWorker from './voxelGrid.worker.ts?worker'
import { ThreeRenderer } from './render'
import { dataSource } from './dataSource'
import {
  PerformanceTracker,
  performanceDB,
  FlameGraph
} from '@/common/performance'
import type { PerformanceRecord, PerformanceSession } from '@/common/performance'

const colorMap = [
  '#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8',
  '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'
].reverse()

function getColorFromValue (value: number, min: number, max: number): string {
  if (min === max) return colorMap[0] ?? '#7aa2f7'
  const normalized = (value - min) / (max - min)
  const index = Math.floor(normalized * (colorMap.length - 1))
  return colorMap[Math.max(0, Math.min(colorMap.length - 1, index))] ?? '#7aa2f7'
}

const containerRef = ref<HTMLDivElement | null>(null)
const rendererRef = ref<ThreeRenderer | null>(null)
const workerRef = ref<Worker | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const filename = ref('CHGDIFF.vasp')
const chunkSize = ref(5e4)
const computeEnv = ref('js')
const level = ref<number | null>(null)
const dataRange = ref<{ min: number; max: number } | null>(null)
const taskId = ref<string | null>(null)
const currentSessionId = ref<string | null>(null)
const showPerformance = ref(false)
const performanceSession = ref<PerformanceSession | null>(null)
const displayLevel = ref<number | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function getTracker (): PerformanceTracker {
  const t = (window as Window & { tracker?: PerformanceTracker }).tracker
  if (!t) throw new Error('window.tracker 未初始化')
  return t
}

async function loadVoxelGrid (name: string, levelValue?: number) {
  const renderer = rendererRef.value
  if (!renderer) {
    error.value = '渲染器未初始化'
    return
  }
  loading.value = true
  error.value = null
  const sessionId = Date.now().toString()
  const tr = getTracker()
  tr.setSessionId(sessionId)
  currentSessionId.value = sessionId
  await performanceDB.init()

  try {
    const loadResult = await dataSource.loadData(name, chunkSize.value)
    const { chunks: chunkResults, shape, taskId: newTaskId } = loadResult
    if (newTaskId) {
      taskId.value = newTaskId
      tr.updateMetadata({ taskId: newTaskId })
    }

    tr.startRecord('merge_chunks', `合并chunk数据 (${chunkResults.length}个)`)
    const totalLength = chunkResults.reduce((sum, r) => sum + r.buffer.byteLength / 8, 0)
    const mergedData = new Float64Array(totalLength)
    let offset = 0
    let globalMin = chunkResults[0]?.min ?? 0
    let globalMax = chunkResults[0]?.max ?? 0
    tr.startRecord('calc_minmax', '计算全局min/max')
    for (const result of chunkResults) {
      const chunkArray = new Float64Array(result.buffer)
      mergedData.set(chunkArray, offset)
      offset += chunkArray.length
      if (result.min < globalMin) globalMin = result.min
      if (result.max > globalMax) globalMax = result.max
    }
    tr.endRecord('calc_minmax')
    tr.endRecord('merge_chunks')

    if (dataRange.value === null) {
      const def = (globalMin + globalMax) / 2
      level.value = def
      displayLevel.value = def
      dataRange.value = { min: globalMin, max: globalMax }
    }
    const finalMin = globalMin
    const finalMax = globalMax

    if (!workerRef.value) {
      workerRef.value = new VoxelGridWorker()
      workerRef.value.onmessage = async (event: MessageEvent) => {
        const message = event.data
        if (message.type === 'result') {
          try {
            const { positionsData, positionsLength, cellsData, cellsLength, shape: s, min: mn, max: mx, level: resultLevel } = message
            const tr2 = getTracker()
            tr2.startRecord('calc_color', '计算颜色')
            const color = getColorFromValue(resultLevel, mn, mx)
            tr2.endRecord('calc_color')
            if (rendererRef.value) {
              tr2.startRecord('render_mesh', '渲染网格')
              rendererRef.value.updateMesh(
                positionsData,
                positionsLength,
                cellsData,
                cellsLength,
                s,
                color
              )
              tr2.endRecord('render_mesh')
            }
            await tr2.complete()
            loading.value = false
          } catch (err) {
            error.value = err instanceof Error ? err.message : '渲染网格时出错'
            loading.value = false
          }
        } else if (message.type === 'error') {
          error.value = message.error ?? '加载数据时出错'
          loading.value = false
        }
      }
      workerRef.value.onerror = (e) => {
        error.value = `Worker 错误: ${e.message}`
        loading.value = false
      }
    }

    tr.startRecord('send_to_worker', '发送数据到VoxelGrid Worker')
    workerRef.value.postMessage(
      {
        type: 'load',
        taskId: newTaskId ?? '',
        shape,
        chunks: chunkResults.map((r) => ({ index: r.chunkIndex, start: 0, end: 0 })),
        dataBuffer: mergedData.buffer,
        level: levelValue,
        min: finalMin,
        max: finalMax,
        sessionId
      },
      [mergedData.buffer]
    )
    tr.endRecord('send_to_worker')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载数据时出错'
    loading.value = false
  }
}

// 仅在手柄释放或防抖后触发重算等值面，拖拽时只更新 displayLevel（由 v-model 处理）
function scheduleLevelUpdate (val: number) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    level.value = val
  }, 200)
}

async function showPerformancePanel () {
  const sid = currentSessionId.value
  if (!sid) return
  await performanceDB.init()
  await performanceDB.flushPendingRecords(sid)
  let session = await performanceDB.getSession(sid)
  if (session?.records?.length) {
    const allTimes = session.records
      .flatMap((r) => [r.startTime, r.endTime])
      .filter((t) => typeof t === 'number' && !isNaN(t))
    if (allTimes.length > 0 && (isNaN(session.sessionStartTime) || isNaN(session.sessionEndTime))) {
      session = {
        ...session,
        sessionStartTime: Math.min(...allTimes),
        sessionEndTime: Math.max(...allTimes)
      }
    }
  }
  try {
    const response = await fetch(`/api/performance?session_id=${encodeURIComponent(sid)}`)
    if (response.ok) {
      const backendData = await response.json()
      const backendRecords = (backendData.records ?? []) as PerformanceRecord[]
      if (backendRecords.length > 0 && session) {
        const mergedRecords = [...session.records, ...backendRecords]
        const allTimes = mergedRecords
          .flatMap((r) => [r.startTime, r.endTime])
          .filter((t) => typeof t === 'number' && !isNaN(t))
        session = {
          ...session,
          records: mergedRecords,
          sessionStartTime: allTimes.length > 0 ? Math.min(...allTimes) : session.sessionStartTime,
          sessionEndTime: allTimes.length > 0 ? Math.max(...allTimes) : session.sessionEndTime
        }
      } else if (backendRecords.length > 0 && !session) {
        const allTimes = backendRecords
          .flatMap((r) => [r.startTime, r.endTime])
          .filter((t) => typeof t === 'number' && !isNaN(t))
        session = {
          sessionId: sid,
          sessionStartTime: allTimes.length > 0 ? Math.min(...allTimes) : Date.now(),
          sessionEndTime: allTimes.length > 0 ? Math.max(...allTimes) : Date.now(),
          records: backendRecords
        }
      }
    }
  } catch (err) {
    console.error('[性能分析] 从后端加载性能数据失败:', err)
  }
  performanceSession.value = session ?? null
  showPerformance.value = true
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return
  rendererRef.value = new ThreeRenderer(container)
})

onUnmounted(() => {
  if (rendererRef.value) {
    rendererRef.value.dispose()
    rendererRef.value = null
  }
  if (workerRef.value) {
    workerRef.value.terminate()
    workerRef.value = null
  }
  if (debounceTimer) clearTimeout(debounceTimer)
})

watch(
  [filename, chunkSize],
  () => {
    if (rendererRef.value && !dataRange.value) {
      loadVoxelGrid(filename.value)
    }
  },
  { immediate: true }
)

watch(
  level,
  (val) => {
    if (val !== null && rendererRef.value && dataRange.value && taskId.value) {
      loadVoxelGrid(filename.value, val)
    }
  }
)

// 拖拽时通过 @update:value 更新 displayLevel，防抖后更新 level 触发重算（避免与初始 load 重复）
watch(
  displayLevel,
  (val) => {
    if (val !== null && dataRange.value && val !== level.value) scheduleLevelUpdate(val)
  }
)
</script>

<template>
  <div
    style="
      padding: 24px;
      height: 100%;
      display: flex;
      flex-direction: column;
    "
  >
    <a-card title="SurfaceNets 3D 可视化" style="margin-bottom: 16px">
      <template #extra>
        <a-space>
          <span v-if="loading" style="color: #7aa2f7">加载中...</span>
          <span v-if="error" style="color: #f7768e">错误: {{ error }}</span>
          <span v-if="!loading && !error && dataRange" style="color: #9ece6a">数据已加载</span>
        </a-space>
      </template>
      <a-row :gutter="[16, 16]">
        <a-col :span="6">
          <div style="margin-bottom: 8px; color: #7aa2f7">选择文件</div>
          <a-select
            v-model:value="filename"
            style="width: 100%"
            :options="[{ label: 'CHGDIFF.vasp', value: 'CHGDIFF.vasp' }]"
          />
        </a-col>
        <a-col :span="6">
          <div style="margin-bottom: 8px; color: #7aa2f7">分块大小 (元素数)</div>
          <a-input-number
            v-model:value="chunkSize"
            style="width: 100%"
            :min="1000"
            :step="100000"
            :formatter="(v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
            :parser="(v: string) => Number(v.replace(/\$\s?|(,*)/g, ''))"
          />
        </a-col>
        <a-col :span="6">
          <div style="margin-bottom: 8px; color: #7aa2f7">选择计算环境</div>
          <a-select
            v-model:value="computeEnv"
            style="width: 100%"
            :options="[{ label: 'js', value: 'js' }]"
          />
        </a-col>
        <a-col :span="24">
          <div style="margin-bottom: 8px; color: #7aa2f7">
            选择等值面
            <span
              v-if="displayLevel !== null && dataRange"
              style="margin-left: 8px; color: #9ece6a"
            >
              {{ displayLevel.toFixed(4) }} (范围: {{ dataRange.min.toFixed(4) }} -
              {{ dataRange.max.toFixed(4) }})
            </span>
          </div>
          <a-slider
            v-if="dataRange && displayLevel !== null"
            :min="dataRange.min"
            :max="dataRange.max"
            :value="displayLevel"
            :step="Math.max((dataRange.max - dataRange.min) / 1000, 1e-10)"
            :tooltip-formatter="(v: number) => v?.toFixed(4)"
            @update:value="(v: number) => { displayLevel = v }"
          />
          <a-slider v-else disabled />
        </a-col>
      </a-row>
    </a-card>

    <a-card size="small" style="margin-bottom: 16px">
      <a-space>
        <a-button
          type="primary"
          :disabled="!currentSessionId"
          @click="showPerformancePanel"
        >
          查看性能分析
        </a-button>
        <a-button v-if="showPerformance" @click="showPerformance = false">
          关闭性能分析
        </a-button>
      </a-space>
    </a-card>

    <FlameGraph v-if="showPerformance" :session="performanceSession" />

    <div
      ref="containerRef"
      style="
        flex: 1;
        width: 100%;
        min-height: 600px;
        background-color: #1a1b26;
      "
    />
  </div>
</template>
