//! 三维线性插值（Trilinear Interpolation）
//!
//! 与 TS 的 linearInterpolate3D 对应：根据原始 3D 标量场和每维扩充倍数 level，
//! 在网格点之间做线性插值，得到更密网格。存储为行优先：index = k * nx * ny + j * nx + i。

use js_sys::Float64Array;
use wasm_bindgen::prelude::*;

/// 根据 shape 和 level 计算插值后的网格尺寸，与 TS 的 getInterpolatedShape 一致。
#[inline]
pub fn get_interpolated_shape(nx: usize, ny: usize, nz: usize, level: usize) -> (usize, usize, usize) {
  (
    (nx - 1) * level + 1,
    (ny - 1) * level + 1,
    (nz - 1) * level + 1,
  )
}

/// 三维线性插值（纯 Rust），与 TS 的 linearInterpolate3d 算法一致。
pub fn linear_interpolate_3d(
  data: &[f64],
  nx: usize,
  ny: usize,
  nz: usize,
  level: usize,
) -> Vec<f64> {
  let (out_nx, out_ny, out_nz) = get_interpolated_shape(nx, ny, nz, level);
  let out_len = out_nx * out_ny * out_nz;
  let mut out = vec![0.0_f64; out_len];

  let get = |i: usize, j: usize, k: usize| -> f64 {
    let idx = k * nx * ny + j * nx + i;
    data.get(idx).copied().unwrap_or(0.0)
  };

  for iz in 0..out_nz {
    let z = iz as f64 / level as f64;
    let k0 = (z.floor() as usize).min(nz - 1);
    let k1 = (k0 + 1).min(nz - 1);
    let tz = z - k0 as f64;

    for iy in 0..out_ny {
      let y = iy as f64 / level as f64;
      let j0 = (y.floor() as usize).min(ny - 1);
      let j1 = (j0 + 1).min(ny - 1);
      let ty = y - j0 as f64;

      for ix in 0..out_nx {
        let x = ix as f64 / level as f64;
        let i0 = (x.floor() as usize).min(nx - 1);
        let i1 = (i0 + 1).min(nx - 1);
        let tx = x - i0 as f64;

        let v000 = get(i0, j0, k0);
        let v100 = get(i1, j0, k0);
        let v010 = get(i0, j1, k0);
        let v110 = get(i1, j1, k0);
        let v001 = get(i0, j0, k1);
        let v101 = get(i1, j0, k1);
        let v011 = get(i0, j1, k1);
        let v111 = get(i1, j1, k1);

        let lerp_x0 = v000 * (1.0 - tx) + v100 * tx;
        let lerp_x1 = v010 * (1.0 - tx) + v110 * tx;
        let lerp_x2 = v001 * (1.0 - tx) + v101 * tx;
        let lerp_x3 = v011 * (1.0 - tx) + v111 * tx;

        let lerp_y0 = lerp_x0 * (1.0 - ty) + lerp_x1 * ty;
        let lerp_y1 = lerp_x2 * (1.0 - ty) + lerp_x3 * ty;

        let value = lerp_y0 * (1.0 - tz) + lerp_y1 * tz;

        let out_idx = iz * out_nx * out_ny + iy * out_nx + ix;
        out[out_idx] = value;
      }
    }
  }

  out
}

/// WASM 导出：与 TS 的 linearInterpolate3d(data, shape, level) 对应。
/// 传入 Float64Array 与 [nx, ny, nz]、level，返回插值后的 Float64Array。
#[wasm_bindgen]
pub fn linear_interpolate_3d_wasm(
  data: Float64Array,
  nx: u32,
  ny: u32,
  nz: u32,
  level: u32,
) -> Float64Array {
  let len = data.length() as usize;
  let mut buf = vec![0.0_f64; len];
  data.copy_to(&mut buf[..]);

  let out = linear_interpolate_3d(&buf, nx as usize, ny as usize, nz as usize, level as usize);
  Float64Array::from(&out[..])
}
