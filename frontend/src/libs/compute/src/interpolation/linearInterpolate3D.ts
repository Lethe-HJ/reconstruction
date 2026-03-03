/**
 * 三维线性插值（Trilinear Interpolation）
 *
 * 根据原始 3D 标量场 data 和每维的扩充倍数 level，在网格点之间做线性插值，
 * 得到更密网格上的 Float64Array。
 *
 * 输出尺寸：每维为 (n - 1) * level + 1，即保留所有原始格点并在其间插入 (level - 1) 个点。
 */

export type Shape3 = [number, number, number];

/**
 * 三维线性插值
 *
 * @param data - 原始三维标量场，按行优先存储：index = k * (nx * ny) + j * nx + i
 * @param shape - 原始网格尺寸 [nx, ny, nz]
 * @param level - 每维插值倍数；每维输出点数 = (n - 1) * level + 1，level >= 1
 * @returns 插值后的 Float64Array，长度为 outNx * outNy * outNz
 */
export function linearInterpolate3d(
  data: Float64Array,
  shape: Shape3,
  level: number,
): Float64Array {
  const [nx, ny, nz] = shape;
  const outNx = (nx - 1) * level + 1;
  const outNy = (ny - 1) * level + 1;
  const outNz = (nz - 1) * level + 1;
  const outLen = outNx * outNy * outNz;
  const out = new Float64Array(outLen);

  const get = (i: number, j: number, k: number): number => {
    const idx = k * nx * ny + j * nx + i;
    return data[idx] ?? 0;
  };

  for (let iz = 0; iz < outNz; iz++) {
    const z = iz / level;
    const k0 = Math.min(Math.floor(z), nz - 1);
    const k1 = Math.min(k0 + 1, nz - 1);
    const tz = z - k0;

    for (let iy = 0; iy < outNy; iy++) {
      const y = iy / level;
      const j0 = Math.min(Math.floor(y), ny - 1);
      const j1 = Math.min(j0 + 1, ny - 1);
      const ty = y - j0;

      for (let ix = 0; ix < outNx; ix++) {
        const x = ix / level;
        const i0 = Math.min(Math.floor(x), nx - 1);
        const i1 = Math.min(i0 + 1, nx - 1);
        const tx = x - i0;

        const v000 = get(i0, j0, k0);
        const v100 = get(i1, j0, k0);
        const v010 = get(i0, j1, k0);
        const v110 = get(i1, j1, k0);
        const v001 = get(i0, j0, k1);
        const v101 = get(i1, j0, k1);
        const v011 = get(i0, j1, k1);
        const v111 = get(i1, j1, k1);

        const lerpX0 = v000 * (1 - tx) + v100 * tx;
        const lerpX1 = v010 * (1 - tx) + v110 * tx;
        const lerpX2 = v001 * (1 - tx) + v101 * tx;
        const lerpX3 = v011 * (1 - tx) + v111 * tx;

        const lerpY0 = lerpX0 * (1 - ty) + lerpX1 * ty;
        const lerpY1 = lerpX2 * (1 - ty) + lerpX3 * ty;

        const value = lerpY0 * (1 - tz) + lerpY1 * tz;

        const outIdx = iz * outNx * outNy + iy * outNx + ix;
        out[outIdx] = value;
      }
    }
  }

  return out;
}

/**
 * 根据 shape 和 level 计算插值后的网格尺寸
 */
export function getInterpolatedShape(shape: Shape3, level: number): Shape3 {
  const [nx, ny, nz] = shape;
  return [(nx - 1) * level + 1, (ny - 1) * level + 1, (nz - 1) * level + 1];
}
