/**
 * SurfaceNets in TypeScript
 * Based on JavaScript version written by Mikola Lysenko (C) 2012
 * MIT License
 *
 * 此文件实现了 SurfaceNets（表面网格提取）算法。
 * 它的作用类似于 Marching Cubes (移动立方体算法)，用于从三维标量场（3D网格）中提取等值面（Isosurface）。
 * 但与 Marching Cubes 不同的是，SurfaceNets 在每个包含等值面的体素（Voxel）内只生成一个顶点（交点的均值），
 * 然后连接相邻体素的顶点来形成多边形面。这样生成的网格通常更平滑，且生成的多边形面数量更少。
 */

// 描述空间边界的类型：[min_x, min_y, min_z], [max_x, max_y, max_z]
export type Bounds = [[number, number, number], [number, number, number]];
export type Vector3 = [number, number, number];
export type Face3 = [number, number, number];

export interface SurfaceNetsResult {
  positions: Vector3[];
  cells: Face3[];
}

// cube_edges 存储立方体的 12 条边。每条边由两个顶点的索引（0-7）表示。
// 一共有 24 个整数，每两个连续整数代表一条边两端的顶点。
const cube_edges = new Int32Array(24);

// edge_table 是一个包含 256 个元素的查找表。
// 立方体有 8 个顶点，根据每个顶点在等值面内还是外，共有 2^8 = 256 种状态组合。
// 该表通过 8 位状态掩码，快速查找到底哪些边被等值面穿过。
const edge_table = new Int32Array(256);

/**
 * 初始化 cube_edges
 */
function initCubeEdges() {
  let k = 0;
  for (let i = 0; i < 8; ++i) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) {
        cube_edges[k++] = i;
        cube_edges[k++] = p;
      }
    }
  }
}

initCubeEdges();

/**
 * 初始化 edge_table
 */
function initEdgeTable() {
  for (let i = 0; i < 256; ++i) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << cube_edges[j]!));
      const b = !!(i & (1 << cube_edges[j + 1]!));
      em |= a !== b ? 1 << (j >> 1) : 0;
    }
    edge_table[i] = em;
  }
}
initEdgeTable();

// 顶点索引的滚动缓冲区。相比于 JS 版本的 Array，使用 TypedArray 性能更好，初始化默认全为0。
let buffer = new Int32Array(4096);

/**
 * surfaceNets 主函数
 * @param dims 三维网格的体素维度 [x, y, z]
 * @param potential 标量场函数 f(x,y,z)，返回标量值。提取的等值面位于标量值为 0 的地方（<0 代表在内部，>0 代表在外部）
 * @param bounds 可选，真实的空间范围
 */
function _surfaceNets(
  dims: Vector3,
  potential: (x: number, y: number, z: number) => number,
  bounds?: Bounds,
): SurfaceNetsResult {
  const actualBounds: Bounds = bounds || [
    [0, 0, 0],
    [dims[0], dims[1], dims[2]],
  ];

  const scale: Vector3 = [
    (actualBounds[1][0] - actualBounds[0][0]) / dims[0],
    (actualBounds[1][1] - actualBounds[0][1]) / dims[1],
    (actualBounds[1][2] - actualBounds[0][2]) / dims[2],
  ];
  const shift: Vector3 = [
    actualBounds[0][0],
    actualBounds[0][1],
    actualBounds[0][2],
  ];

  const vertices: Vector3[] = [];
  const faces: Face3[] = [];
  let n = 0;
  const x: Vector3 = [0, 0, 0];
  const R: Vector3 = [1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)];
  const grid = new Float64Array(8);
  let buf_no = 1;

  // 确保 buffer 足够容纳两层数据，动态扩容
  if (R[2] * 2 > buffer.length) {
    const newBuffer = new Int32Array(R[2] * 2);
    newBuffer.set(buffer);
    buffer = newBuffer;
  }

  for (
    x[2] = 0;
    x[2] < dims[2] - 1;
    ++x[2], n += dims[0], buf_no ^= 1, R[2] = -R[2]
  ) {
    let m = 1 + (dims[0] + 1) * (1 + buf_no * (dims[1] + 1));
    for (x[1] = 0; x[1] < dims[1] - 1; ++x[1], ++n, m += 2) {
      for (x[0] = 0; x[0] < dims[0] - 1; ++x[0], ++n, ++m) {
        let mask = 0;
        let g = 0;
        for (let k = 0; k < 2; ++k) {
          for (let j = 0; j < 2; ++j) {
            for (let i = 0; i < 2; ++i, ++g) {
              const p = potential(
                scale[0] * (x[0] + i) + shift[0],
                scale[1] * (x[1] + j) + shift[1],
                scale[2] * (x[2] + k) + shift[2],
              );
              grid[g] = p;
              mask |= p < 0 ? 1 << g : 0;
            }
          }
        }

        if (mask === 0 || mask === 0xff) continue;

        const edge_mask = edge_table[mask]!;
        const v: Vector3 = [0.0, 0.0, 0.0];
        let e_count = 0;

        for (let i = 0; i < 12; ++i) {
          if (!(edge_mask & (1 << i))) continue;
          ++e_count;

          const e0 = cube_edges[i << 1]!;
          const e1 = cube_edges[(i << 1) + 1]!;
          const g0 = grid[e0]!;
          const g1 = grid[e1]!;
          let t = g0 - g1;

          if (Math.abs(t) > 1e-6) {
            t = g0 / t;
          } else {
            continue;
          }

          for (let j = 0, k = 1; j < 3; ++j, k <<= 1) {
            const a = e0 & k;
            const b = e1 & k;
            if (a !== b) {
              v[j as 0 | 1 | 2] += a ? 1.0 - t : t;
            } else {
              v[j as 0 | 1 | 2] += a ? 1.0 : 0;
            }
          }
        }

        const s = 1.0 / e_count;
        for (let i = 0; i < 3; ++i) {
          const idx = i as 0 | 1 | 2;
          v[idx] = scale[idx] * (x[idx] + s * v[idx]) + shift[idx];
        }

        buffer[m] = vertices.length;
        vertices.push(v);

        for (let i = 0; i < 3; ++i) {
          if (!(edge_mask & (1 << i))) continue;

          const iu = ((i + 1) % 3) as 0 | 1 | 2;
          const iv = ((i + 2) % 3) as 0 | 1 | 2;

          if (x[iu] === 0 || x[iv] === 0) continue;

          const du = R[iu];
          const dv = R[iv];

          if (mask & 1) {
            faces.push([buffer[m]!, buffer[m - du]!, buffer[m - dv]!]);
            faces.push([
              buffer[m - dv]!,
              buffer[m - du]!,
              buffer[m - du - dv]!,
            ]);
          } else {
            faces.push([buffer[m]!, buffer[m - dv]!, buffer[m - du]!]);
            faces.push([
              buffer[m - du]!,
              buffer[m - dv]!,
              buffer[m - du - dv]!,
            ]);
          }
        }
      }
    }
  }

  return { positions: vertices, cells: faces };
}

export function surfaceNets(
  xm: number,
  ym: number,
  zm: number,
  data: Float64Array,
  selectedLevel: number,
) {
  const extendedShape: Vector3 = [xm + 2, ym + 2, zm + 2];
  const potential = (x: number, y: number, z: number): number => {
    const i = Math.floor(x) - 1;
    const j = Math.floor(y) - 1;
    const k = Math.floor(z) - 1;
    const idx = (((i + xm) % xm) + xm) % xm;
    const idy = (((j + ym) % ym) + ym) % ym;
    const idz = (((k + zm) % zm) + zm) % zm;
    const index = idz * xm * ym + idy * xm + idx;
    return (data[index] ?? 0) - selectedLevel;
  };
  return _surfaceNets(extendedShape, potential, undefined);
}
