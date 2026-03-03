<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import VoxelGridWorker from "./voxelGrid.worker.ts?worker";
import { ThreeRenderer } from "./render";
import { dataSource } from "./dataSource";
import { get as getInterpolation } from "./interpolationStore";

const colorMap = [
  "#313695",
  "#4575b4",
  "#74add1",
  "#abd9e9",
  "#e0f3f8",
  "#ffffbf",
  "#fee090",
  "#fdae61",
  "#f46d43",
  "#d73027",
  "#a50026",
].reverse();

function getColorFromValue(value: number, min: number, max: number): string {
  if (min === max) return colorMap[0] ?? "#7aa2f7";
  const normalized = (value - min) / (max - min);
  const index = Math.floor(normalized * (colorMap.length - 1));
  return (
    colorMap[Math.max(0, Math.min(colorMap.length - 1, index))] ?? "#7aa2f7"
  );
}

const containerRef = ref<HTMLDivElement | null>(null);
const rendererRef = ref<ThreeRenderer | null>(null);
const workerRef = ref<Worker | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const filename = ref("CHGDIFF.vasp");
const chunkSize = ref(5e4);
const smoothLevel = ref(1);
const computeEnv = ref("rust");
const useCachedData = ref(localStorage.getItem("useCachedData") !== "false");
const level = ref<number | null>(null);

watch(useCachedData, (val) => {
  localStorage.setItem("useCachedData", String(val));
});
const dataRange = ref<{ min: number; max: number } | null>(null);
const taskId = ref<string | null>(null);
const displayLevel = ref<number | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function loadVoxelGrid(name: string, levelValue?: number) {
  const renderer = rendererRef.value;
  if (!renderer) {
    error.value = "渲染器未初始化";
    return;
  }
  // 仅在实际加载体素数据时显示“加载中”；仅更新等值面时不影响“数据已加载”状态
  const isVoxelLoad = dataRange.value === null;
  if (isVoxelLoad) {
    loading.value = true;
    error.value = null;
  }

  try {
    const loadResult = await dataSource.loadData(
      name,
      chunkSize.value,
      useCachedData.value,
    );
    const { chunks: chunkResults, shape, taskId: newTaskId } = loadResult;
    if (newTaskId) {
      taskId.value = newTaskId;
    }

    const totalLength = chunkResults.reduce(
      (sum, r) => sum + r.buffer.byteLength / 8,
      0,
    );
    const mergedData = new Float64Array(totalLength);
    let offset = 0;
    let globalMin = chunkResults[0]?.min ?? 0;
    let globalMax = chunkResults[0]?.max ?? 0;
    for (const result of chunkResults) {
      const chunkArray = new Float64Array(result.buffer);
      mergedData.set(chunkArray, offset);
      offset += chunkArray.length;
      if (result.min < globalMin) globalMin = result.min;
      if (result.max > globalMax) globalMax = result.max;
    }

    if (dataRange.value === null) {
      const def = (globalMin + globalMax) / 2;
      level.value = def;
      displayLevel.value = def;
      dataRange.value = { min: globalMin, max: globalMax };
    }
    const finalMin = globalMin;
    const finalMax = globalMax;

    let dataToSend: ArrayBuffer = mergedData.buffer;
    let shapeToSend: [number, number, number] = shape;

    if (smoothLevel.value > 1) {
      const interpResult = await getInterpolation(
        newTaskId ?? taskId.value ?? "",
        shape,
        smoothLevel.value,
        { dataBuffer: mergedData.buffer, computeEnv: computeEnv.value as "js" | "rust" }
      );
      dataToSend = interpResult.data.buffer as ArrayBuffer;
      shapeToSend = interpResult.shape;
    }

    if (!workerRef.value) {
      workerRef.value = new VoxelGridWorker();
      workerRef.value.onmessage = async (event: MessageEvent) => {
        const message = event.data;
        if (message.type === "result") {
          try {
            const {
              positionsData,
              positionsLength,
              cellsData,
              cellsLength,
              shape: s,
              min: mn,
              max: mx,
              level: resultLevel,
            } = message;
            const color = getColorFromValue(resultLevel, mn, mx);
            if (rendererRef.value) {
              rendererRef.value.updateMesh(
                positionsData,
                positionsLength,
                cellsData,
                cellsLength,
                s,
                color,
              );
            }
            loading.value = false;
          } catch (err) {
            error.value = err instanceof Error ? err.message : "渲染网格时出错";
            loading.value = false;
          }
        } else if (message.type === "error") {
          error.value = message.error ?? "加载数据时出错";
          loading.value = false;
        }
      };
      workerRef.value.onerror = (e) => {
        error.value = `Worker 错误: ${e.message}`;
        loading.value = false;
      };
    }

    workerRef.value.postMessage(
      {
        type: "load",
        taskId: newTaskId ?? taskId.value ?? "",
        shape: shapeToSend,
        chunks: chunkResults.map((r) => ({
          index: r.chunkIndex,
          start: 0,
          end: 0,
        })),
        dataBuffer: dataToSend,
        level: levelValue,
        min: finalMin,
        max: finalMax,
        computeEnv: computeEnv.value,
      },
      [dataToSend],
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载数据时出错";
    loading.value = false;
  }
}

// 仅在手柄释放或防抖后触发重算等值面，拖拽时只更新 displayLevel（由 v-model 处理）
function scheduleLevelUpdate(val: number) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    level.value = val;
  }, 200);
}

onMounted(() => {
  const container = containerRef.value;
  if (!container) return;
  rendererRef.value = new ThreeRenderer(container);
  // 渲染器就绪后若尚未加载过数据，触发加载（watch 的 immediate 在 onMounted 前执行，当时 rendererRef 为 null）
  if (!dataRange.value) {
    loadVoxelGrid(filename.value);
  }
});

onUnmounted(() => {
  if (rendererRef.value) {
    rendererRef.value.dispose();
    rendererRef.value = null;
  }
  if (workerRef.value) {
    workerRef.value.terminate();
    workerRef.value = null;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
});

watch(
  [filename, chunkSize, smoothLevel, computeEnv],
  () => {
    if (rendererRef.value && !dataRange.value) {
      loadVoxelGrid(filename.value);
    } else if (rendererRef.value && dataRange.value) {
      loadVoxelGrid(filename.value, level.value ?? undefined);
    }
  },
  { immediate: true },
);

watch(level, (val) => {
  if (val !== null && rendererRef.value && dataRange.value) {
    loadVoxelGrid(filename.value, val);
  }
});

// 拖拽时通过 @update:value 更新 displayLevel，防抖后更新 level 触发重算（避免与初始 load 重复）
watch(displayLevel, (val) => {
  if (val !== null && dataRange.value && val !== level.value)
    scheduleLevelUpdate(val);
});
</script>

<template>
  <div
    style="padding: 12px; height: 100%; display: flex; flex-direction: column"
  >
    <a-card
      title="SurfaceNets 3D 可视化"
      size="small"
      style="margin-bottom: 8px"
      :body-style="{ padding: '12px 16px' }"
    >
      <template #extra>
        <a-space size="small">
          <span v-if="loading" style="color: #7aa2f7">加载中...</span>
          <span v-if="error" style="color: #f7768e">错误: {{ error }}</span>
          <span v-if="!loading && !error && dataRange" style="color: #9ece6a"
            >数据已加载</span
          >
        </a-space>
      </template>
      <a-row :gutter="[12, 8]" align="middle">
        <a-col :span="6">
          <div class="controlLabel">选择文件</div>
          <a-select
            v-model:value="filename"
            size="small"
            style="width: 100%"
            :options="[{ label: 'CHGDIFF.vasp', value: 'CHGDIFF.vasp' }]"
          />
        </a-col>
        <a-col :span="6">
          <div class="controlLabel">分块大小 (元素数)</div>
          <a-input-number
            v-model:value="chunkSize"
            size="small"
            style="width: 100%"
            :min="1000"
            :step="100000"
            :formatter="(v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ',')"
            :parser="(v: string) => Number(v.replace(/\$\s?|(,*)/g, ''))"
          />
        </a-col>
        <a-col :span="6">
          <div class="controlLabel">平滑</div>
          <a-input-number
            v-model:value="smoothLevel"
            size="small"
            style="width: 100%"
            :min="1"
            :step="1"
          />
        </a-col>
        <a-col :span="6">
          <div class="controlLabel">计算环境</div>
          <a-select
            v-model:value="computeEnv"
            size="small"
            style="width: 100%"
            :options="[
              { label: 'js', value: 'js' },
              { label: 'rust', value: 'rust' },
            ]"
          />
        </a-col>
        <a-col :span="6">
          <div class="controlLabel">使用缓存</div>
          <a-radio-group v-model:value="useCachedData" size="small">
            <a-radio :value="true">是</a-radio>
            <a-radio :value="false">否</a-radio>
          </a-radio-group>
        </a-col>
        <a-col :span="24">
          <div class="controlLabel">
            等值面
            <span
              v-if="displayLevel !== null && dataRange"
              style="margin-left: 6px; color: #9ece6a; font-weight: normal"
            >
              {{ displayLevel.toFixed(4) }} ({{ dataRange.min.toFixed(4) }} -
              {{ dataRange.max.toFixed(4) }})
            </span>
          </div>
          <a-slider
            v-if="dataRange && displayLevel !== null"
            :min="dataRange.min"
            :max="dataRange.max"
            v-model:value="displayLevel"
            :step="Math.max((dataRange.max - dataRange.min) / 1000, 1e-10)"
            :tooltip-formatter="(v: number) => v?.toFixed(4)"
            style="margin: 0 8px 0 0"
          />
          <a-slider v-else disabled style="margin: 0 8px 0 0" />
        </a-col>
      </a-row>
    </a-card>

    <div
      ref="containerRef"
      style="flex: 1; width: 100%; min-height: 600px; background-color: #1a1b26; position: relative"
    />
  </div>
</template>

<style scoped>
.controlLabel {
  margin-bottom: 4px;
  color: #7aa2f7;
  font-size: 12px;
}
</style>
