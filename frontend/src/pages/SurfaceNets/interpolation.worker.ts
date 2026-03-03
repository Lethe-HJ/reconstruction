/// <reference lib="webworker" />

import {
  linearInterpolate3d,
  getInterpolatedShape,
  type Shape3,
} from "../../libs/compute/src/interpolation/linearInterpolate3D.js";

type InterpolateMessage = {
  type: "interpolate";
  dataBuffer: ArrayBuffer;
  shape: Shape3;
  smoothLevel: number;
  computeEnv: "js" | "rust";
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function initWasm(): Promise<{
  linear_interpolate_3d_wasm: (
    data: Float64Array,
    nx: number,
    ny: number,
    nz: number,
    level: number,
  ) => Float64Array;
}> {
  const wasmInit =
    await import("../../libs/compute/pkg/wasm_interpolation/wasm_interpolation.js");
  const wasmUrl =
    await import("../../libs/compute/pkg/wasm_interpolation/wasm_interpolation_bg.wasm?url");
  await wasmInit.default(wasmUrl.default);
  return wasmInit;
}

let wasmInitPromise: Promise<{
  linear_interpolate_3d_wasm: (
    data: Float64Array,
    nx: number,
    ny: number,
    nz: number,
    level: number,
  ) => Float64Array;
}> | null = null;

ctx.addEventListener(
  "message",
  async (event: MessageEvent<InterpolateMessage>) => {
    if (event.data.type !== "interpolate") return;
    const { dataBuffer, shape, smoothLevel, computeEnv } = event.data;
    const data = new Float64Array(dataBuffer);
    const [nx, ny, nz] = shape;
    let outData: Float64Array;
    let outShape: Shape3;

    try {
      if (computeEnv === "js") {
        console.time("linearInterpolate3d (JS)");
        outData = linearInterpolate3d(data, shape, smoothLevel);
        console.timeEnd("linearInterpolate3d (JS)");
        outShape = getInterpolatedShape(shape, smoothLevel);
      } else {
        if (!wasmInitPromise) {
          wasmInitPromise = initWasm();
        }
        const wasm = await wasmInitPromise;
        console.time("linearInterpolate3d (WASM)");
        outData = wasm.linear_interpolate_3d_wasm(
          data,
          nx,
          ny,
          nz,
          smoothLevel,
        );
        console.timeEnd("linearInterpolate3d (WASM)");
        outShape = getInterpolatedShape(shape, smoothLevel);
      }
      ctx.postMessage(
        { type: "interpolateResult", data: outData.buffer, shape: outShape },
        [outData.buffer],
      );
    } catch (err) {
      ctx.postMessage({
        type: "interpolateError",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
