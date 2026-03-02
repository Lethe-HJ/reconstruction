/// <reference lib="webworker" />

declare const __DEV__: boolean;

import { surfaceNets } from "../../compute/surfacenets/src/surfacenets.js";

type WorkerInputMessage = {
  type: "load";
  taskId: string;
  shape: [number, number, number];
  chunks: Array<{ index: number; start: number; end: number }>;
  dataBuffer: ArrayBuffer;
  level?: number;
  min?: number;
  max?: number;
  workerIndex?: number;
  computeEnv?: "js" | "rust";
};

type WorkerOutputMessage =
  | {
      type: "result";
      positionsData: ArrayBuffer;
      positionsLength: number;
      cellsData: ArrayBuffer;
      cellsLength: number;
      shape: [number, number, number];
      min: number;
      max: number;
      level: number;
    }
  | { type: "error"; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

self.addEventListener(
  "message",
  async (event: MessageEvent<WorkerInputMessage>) => {
    if (event.data.type !== "load") return;
    try {
      const { shape, dataBuffer, level, min, max } = event.data;
      const [xm, ym, zm] = shape;
      const data = new Float64Array(dataBuffer);
      const selectedLevel = level !== undefined ? level : (min! + max!) / 2;
      let flatPositions: Float32Array;
      let flatCells: Uint32Array;
      let positionsLength: number;
      let cellsLength: number;

      if (event.data.computeEnv === "rust") {
        console.time("surfaceNets (Rust)");
        const wasmInit =
          await import("../../compute/surfacenets/pkg/wasm_surfacenets.js");
        // @ts-ignore
        const wasmUrl =
          await import("../../compute/surfacenets/pkg/wasm_surfacenets_bg.wasm?url");
        // 等待 wasm 初始化，如果是在 Worker 里通常需要传入 wasm 的路径
        await wasmInit.default(wasmUrl.default);
        const result = wasmInit.surface_nets_rust(
          new Uint32Array(shape),
          data,
          selectedLevel,
        ) as any;

        flatPositions = result.positions;
        flatCells = result.cells;
        positionsLength = result.positionsLength;
        cellsLength = result.cellsLength;
        console.timeEnd("surfaceNets (Rust)");
      } else {
        console.time("surfaceNets (JS)");
        const result = surfaceNets(xm, ym, zm, data, selectedLevel);
        console.timeEnd("surfaceNets (JS)");

        flatPositions = new Float32Array(result.positions.length * 3);
        for (let i = 0; i < result.positions.length; i++) {
          const p = result.positions[i];
          if (!p) continue;
          flatPositions[i * 3] = p[0];
          flatPositions[i * 3 + 1] = p[1];
          flatPositions[i * 3 + 2] = p[2];
        }
        flatCells = new Uint32Array(result.cells.flat());
        positionsLength = result.positions.length;
        cellsLength = result.cells.length;
      }

      const message: WorkerOutputMessage = {
        type: "result",
        positionsData: flatPositions.buffer as ArrayBuffer,
        positionsLength: positionsLength,
        cellsData: flatCells.buffer as ArrayBuffer,
        cellsLength: cellsLength,
        shape,
        min: min!,
        max: max!,
        level: selectedLevel,
      };
      ctx.postMessage(message, [
        flatPositions.buffer as ArrayBuffer,
        flatCells.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      ctx.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
