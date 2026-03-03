/* eslint-disable */
/**
 * SurfaceNets in JavaScript
 * Written by Mikola Lysenko (C) 2012
 * MIT License
 *
 * 此文件实现了 SurfaceNets（表面网格提取）算法。
 * 它的作用类似于 Marching Cubes (移动立方体算法)，用于从三维标量场（3D网格）中提取等值面（Isosurface）。
 * 但与 Marching Cubes 不同的是，SurfaceNets 在每个包含等值面的体素（Voxel）内只生成一个顶点（交点的均值），
 * 然后连接相邻体素的顶点来形成多边形面。这样生成的网格通常更平滑，且生成的多边形面数量更少。
 */
'use strict'

// cube_edges 存储立方体的 12 条边。每条边由两个顶点的索引（0-7）表示。
// 一共有 24 个整数，每两个连续整数代表一条边两端的顶点。
var cube_edges = new Int32Array(24),
  // edge_table 是一个包含 256 个元素的查找表。
  // 立方体有 8 个顶点，根据每个顶点在等值面内还是外，共有 2^8 = 256 种状态组合。
  // 该表通过 8 位状态掩码，快速查找到底哪些边被等值面穿过（用 12 位整数掩码表示 12 条边的被穿过情况）。
  edge_table = new Int32Array(256)

// 立即执行函数：初始化 cube_edges 和 edge_table
;(function () {
  var k = 0
  // 初始化 cube_edges: 生成立方体 12 条边的顶点配对
  // i 是第一个顶点的索引 (0 到 7)
  for (var i = 0; i < 8; ++i) {
    // j 用二进制位移来模拟 x, y, z 轴的增量 (1, 2, 4)
    for (var j = 1; j <= 4; j <<= 1) {
      // p 是与 i 沿坐标轴相邻的另一个顶点的索引
      var p = i ^ j
      // 为了避免重复添加无向边，只在 i <= p 时记录
      if (i <= p) {
        cube_edges[k++] = i
        cube_edges[k++] = p
      }
    }
  }
  // 初始化 edge_table: 计算 256 种符号配置下的相交边掩码
  for (var i = 0; i < 256; ++i) {
    var em = 0
    // 遍历 12 条边 (24 个顶点，每次步进 2)
    for (var j = 0; j < 24; j += 2) {
      // 检查当前边两个顶点的状态位是否被置为 1 (基于组合 i)
      var a = !!(i & (1 << cube_edges[j])),
        b = !!(i & (1 << cube_edges[j + 1]))
      // 如果两个顶点的符号不同，说明等值面穿过这条边
      // j >> 1 即边号（0 到 11），将其记录到边掩码 em 中
      em |= a !== b ? 1 << (j >> 1) : 0
    }
    edge_table[i] = em
  }
})()

// 顶点索引的滚动缓冲区。用来保存上一层（Z轴）计算出的顶点索引，以便相邻体素之间构建三角形面。
var buffer = new Array(4096)
;(function () {
  for (var i = 0; i < buffer.length; ++i) buffer[i] = 0
})()

/**
 * surfaceNets 主函数
 * @param {number[]} dims - 三维网格的体素维度 [x, y, z]
 * @param {Function} potential - 标量场函数 f(x,y,z)，返回标量值。提取的等值面位于标量值为 0 的地方（<0 代表在内部，>0 代表在外部）。
 * @param {number[][]} bounds - 可选参数。真实的空间范围，例如 [[minX, minY, minZ], [maxX, maxY, maxZ]]
 * @returns {object} 返回一个对象包含 positions (顶点坐标数组) 和 cells (三角形面索引数组)
 */
function surfaceNets (dims, potential, bounds) {
  // 如果没有提供 bounds，则默认空间范围与网格尺寸相同：从 [0,0,0] 到 dims
  if (!bounds) bounds = [[0, 0, 0], dims]

  // 计算网格坐标到实际空间坐标的缩放比例 (scale) 和平移量 (shift)
  var scale = [0, 0, 0], shift = [0, 0, 0]
  for (var i = 0; i < 3; ++i) {
    scale[i] = (bounds[1][i] - bounds[0][i]) / dims[i]
    shift[i] = bounds[0][i]
  }

  var vertices = [], faces = [], n = 0, x = [0, 0, 0],
    // R 用于在 1D 数组(buffer)中进行 3D 偏移寻址，分别对应 X, Y, Z 轴上的步长
    R = [1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)],
    // grid 缓存当前处理的体素 8 个角的 potential 值
    grid = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    // buf_no 是 buffer 的双重缓冲切换标志，用于区分奇数层和偶数层
    buf_no = 1

  // 如果当前缓冲区大小不够容纳两层数据（由于 Z 步长较大），动态扩容 buffer
  if (R[2] * 2 > buffer.length) {
    var ol = buffer.length
    buffer.length = R[2] * 2
    while (ol < buffer.length) buffer[ol++] = 0
  }

  // 开始遍历三维网格的所有体素
  // x[2] 代表 z 轴坐标。每次 z 增加，翻转 buf_no，并翻转 Z 轴步长 R[2] 符号（实现滚动缓冲区的覆盖更新）
  for (x[2] = 0; x[2] < dims[2] - 1; ++x[2], n += dims[0], buf_no ^= 1, R[2] = -R[2]) {
    // m 是 buffer 数组中当前体素对应的索引位置
    var m = 1 + (dims[0] + 1) * (1 + buf_no * (dims[1] + 1))

    // 遍历 Y 轴
    for (x[1] = 0; x[1] < dims[1] - 1; ++x[1], ++n, m += 2)
      // 遍历 X 轴
      for (x[0] = 0; x[0] < dims[0] - 1; ++x[0], ++n, ++m) {

        var mask = 0, g = 0
        // 获取当前体素 8 个角的标量场值，并计算状态组合 mask
        for (var k = 0; k < 2; ++k)
          for (var j = 0; j < 2; ++j)
            for (var i = 0; i < 2; ++i, ++g) {
              // 通过 scale 和 shift 将体素的网格坐标映射到实际空间坐标，调用 potential 采样函数
              var p = potential(
                scale[0] * (x[0] + i) + shift[0],
                scale[1] * (x[1] + j) + shift[1],
                scale[2] * (x[2] + k) + shift[2]
              )
              grid[g] = p
              // 如果 potential < 0（代表在物体内部），将掩码对应位设为 1
              mask |= p < 0 ? 1 << g : 0
            }

        // mask 为 0 说明 8 个角全在外部，mask 为 0xff(255) 说明全在内部。
        // 这两种情况意味着没有等值面穿过该体素，因此直接跳过。
        if (mask === 0 || mask === 0xff) continue

        // 查表获取哪些边被穿过
        var edge_mask = edge_table[mask], v = [0.0, 0.0, 0.0], e_count = 0

        // 遍历立方体的 12 条边，求出等值面穿过体素边界的精确坐标点
        for (var i = 0; i < 12; ++i) {
          // 如果该边没有被等值面穿过，跳过
          if (!(edge_mask & (1 << i))) continue
          ++e_count // 记录被穿过的边的数量

          // 获取这条边两端点的潜在值（即 grid 缓存的 potential）
          var e0 = cube_edges[i << 1], e1 = cube_edges[(i << 1) + 1],
            g0 = grid[e0], g1 = grid[e1], t = g0 - g1

          // 通过线性插值计算出零等值面（p=0）精确地位于这条边的什么比例 (t)
          if (Math.abs(t) > 1e-6) t = g0 / t
          else continue

          // 将插值点坐标累加到 v 中，这里先在 [0, 1] 的相对坐标系中累加
          for (var j = 0, k = 1; j < 3; ++j, k <<= 1) {
            var a = e0 & k, b = e1 & k
            if (a !== b) v[j] += a ? 1.0 - t : t
            else v[j] += a ? 1.0 : 0
          }
        }

        // 求被穿过的边的交点的中心位置（平均值）。这也是 SurfaceNets 的核心：每个包含表面的体素产生唯一一个中心顶点
        var s = 1.0 / e_count
        for (var i = 0; i < 3; ++i) {
          // 加上所在体素的基底坐标，并将其映射为真实的空间坐标
          v[i] = scale[i] * (x[i] + s * v[i]) + shift[i]
        }

        // 在 buffer 中记录这个新生成的顶点在 vertices 数组中的索引编号
        buffer[m] = vertices.length
        vertices.push(v)

        // 生成多边形面：将相邻体素产生的顶点连成三角形面
        // 每个体素只需要考虑沿三个正向维度边界的面（避免与相邻体素重复生成面）
        for (var i = 0; i < 3; ++i) {
          // 如果沿着该维度的正向边没有被等值面穿过，则说明那个方向没有共享的面，跳过
          if (!(edge_mask & (1 << i))) continue

          // 确定另外两个切面维度的轴向 (iu, iv)，它们构成了面的方向
          var iu = (i + 1) % 3, iv = (i + 2) % 3

          // 如果体素处于坐标边界上，因为无法向后回溯找到相邻体素的顶点，跳过
          if (x[iu] === 0 || x[iv] === 0) continue

          // 获取在 buffer 中的偏移量，从而在缓存中查到周边相邻体素之前生成的顶点索引
          var du = R[iu], dv = R[iv]

          // 根据当前顶点被包含方向的不同，以不同的顶点顺序（顺时针/逆时针）来添加三角形，确保法线方向指向模型外部
          if (mask & 1) {
            faces.push([buffer[m], buffer[m - du], buffer[m - dv]])
            faces.push([buffer[m - dv], buffer[m - du], buffer[m - du - dv]])
          } else {
            faces.push([buffer[m], buffer[m - dv], buffer[m - du]])
            faces.push([buffer[m - du], buffer[m - dv], buffer[m - du - dv]])
          }
        }
      }
  }

  // 返回所有的顶点坐标和组成三角形面的顶点索引
  return { positions: vertices, cells: faces }
}

export { surfaceNets }
