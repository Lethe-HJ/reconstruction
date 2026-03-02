use wasm_bindgen::prelude::*;
use js_sys::{Float32Array, Uint32Array, Object, Reflect};
use std::sync::OnceLock;

static CUBE_EDGES: OnceLock<[i32; 24]> = OnceLock::new();
static EDGE_TABLE: OnceLock<[i32; 256]> = OnceLock::new();

fn init_tables() {
    CUBE_EDGES.get_or_init(|| {
        let mut edges = [0; 24];
        let mut k = 0;
        for i in 0..8 {
            let mut j = 1;
            while j <= 4 {
                let p = i ^ j;
                if i <= p {
                    edges[k] = i;
                    edges[k + 1] = p;
                    k += 2;
                }
                j <<= 1;
            }
        }
        edges
    });

    EDGE_TABLE.get_or_init(|| {
        let edges = CUBE_EDGES.get().unwrap();
        let mut table = [0; 256];
        for i in 0..256 {
            let mut em = 0;
            for j in (0..24).step_by(2) {
                let a = (i & (1 << edges[j])) != 0;
                let b = (i & (1 << edges[j + 1])) != 0;
                if a != b {
                    em |= 1 << (j >> 1);
                }
            }
            table[i] = em;
        }
        table
    });
}

#[wasm_bindgen]
pub fn surface_nets_rust(shape: &[u32], data: &[f64], level: f64) -> Result<Object, JsValue> {
    init_tables();
    let cube_edges = CUBE_EDGES.get().unwrap();
    let edge_table = EDGE_TABLE.get().unwrap();

    let dims = [shape[0] + 2, shape[1] + 2, shape[2] + 2];
    let xm = shape[0] as i32;
    let ym = shape[1] as i32;
    let zm = shape[2] as i32;

    let potential = |x: f64, y: f64, z: f64| -> f64 {
        let i = (x.floor() as i32) - 1;
        let j = (y.floor() as i32) - 1;
        let k = (z.floor() as i32) - 1;
        
        let idx = (((i + xm) % xm) + xm) % xm;
        let idy = (((j + ym) % ym) + ym) % ym;
        let idz = (((k + zm) % zm) + zm) % zm;
        
        let index = (idz * xm * ym + idy * xm + idx) as usize;
        let val = if index < data.len() { data[index] } else { 0.0 };
        val - level
    };

    let mut vertices: Vec<f32> = Vec::new();
    let mut faces: Vec<u32> = Vec::new();

    let mut buffer = vec![0i32; 4096];
    let mut x = [0i32; 3];
    let mut r = [1i32, dims[0] as i32 + 1, (dims[0] as i32 + 1) * (dims[1] as i32 + 1)];
    let mut grid = [0.0f64; 8];
    let mut buf_no = 1;

    if (r[2] * 2) as usize > buffer.len() {
        buffer.resize((r[2] * 2) as usize, 0);
    }

    x[2] = 0;
    while x[2] < (dims[2] - 1) as i32 {
        let mut m = 1 + (dims[0] as i32 + 1) * (1 + buf_no * (dims[1] as i32 + 1));
        
        x[1] = 0;
        while x[1] < (dims[1] - 1) as i32 {
            x[0] = 0;
            while x[0] < (dims[0] - 1) as i32 {
                let mut mask = 0;
                let mut g = 0;
                for k in 0..2 {
                    for j in 0..2 {
                        for i in 0..2 {
                            let p = potential(
                                (x[0] + i) as f64,
                                (x[1] + j) as f64,
                                (x[2] + k) as f64
                            );
                            grid[g] = p;
                            if p < 0.0 {
                                mask |= 1 << g;
                            }
                            g += 1;
                        }
                    }
                }

                if mask == 0 || mask == 0xff {
                    x[0] += 1;
                    m += 1;
                    continue;
                }

                let edge_mask = edge_table[mask as usize];
                let mut v = [0.0f64; 3];
                let mut e_count = 0;

                for i in 0..12 {
                    if (edge_mask & (1 << i)) == 0 {
                        continue;
                    }
                    e_count += 1;
                    let e0 = cube_edges[i << 1] as usize;
                    let e1 = cube_edges[(i << 1) + 1] as usize;
                    let g0 = grid[e0];
                    let g1 = grid[e1];
                    let mut t = g0 - g1;
                    
                    if t.abs() > 1e-6 {
                        t = g0 / t;
                    } else {
                        continue;
                    }

                    let mut k = 1;
                    for j in 0..3 {
                        let a = e0 & k;
                        let b = e1 & k;
                        if a != b {
                            v[j] += if a != 0 { 1.0 - t } else { t };
                        } else {
                            v[j] += if a != 0 { 1.0 } else { 0.0 };
                        }
                        k <<= 1;
                    }
                }

                let s = 1.0 / (e_count as f64);
                for i in 0..3 {
                    v[i] = (x[i] as f64) + s * v[i];
                }

                buffer[m as usize] = (vertices.len() / 3) as i32;
                vertices.push(v[0] as f32);
                vertices.push(v[1] as f32);
                vertices.push(v[2] as f32);

                for i in 0..3 {
                    if (edge_mask & (1 << i)) == 0 {
                        continue;
                    }
                    let iu = (i + 1) % 3;
                    let iv = (i + 2) % 3;
                    if x[iu] == 0 || x[iv] == 0 {
                        continue;
                    }
                    let du = r[iu];
                    let dv = r[iv];

                    if (mask & 1) != 0 {
                        faces.push(buffer[m as usize] as u32);
                        faces.push(buffer[(m - du) as usize] as u32);
                        faces.push(buffer[(m - dv) as usize] as u32);

                        faces.push(buffer[(m - dv) as usize] as u32);
                        faces.push(buffer[(m - du) as usize] as u32);
                        faces.push(buffer[(m - du - dv) as usize] as u32);
                    } else {
                        faces.push(buffer[m as usize] as u32);
                        faces.push(buffer[(m - dv) as usize] as u32);
                        faces.push(buffer[(m - du) as usize] as u32);

                        faces.push(buffer[(m - du) as usize] as u32);
                        faces.push(buffer[(m - dv) as usize] as u32);
                        faces.push(buffer[(m - du - dv) as usize] as u32);
                    }
                }

                x[0] += 1;
                m += 1;
            }
            x[1] += 1;
            m += 2;
        }
        x[2] += 1;
        buf_no ^= 1;
        r[2] = -r[2];
    }

    let pos_arr = Float32Array::from(vertices.as_slice());
    let cell_arr = Uint32Array::from(faces.as_slice());

    let obj = Object::new();
    Reflect::set(&obj, &JsValue::from_str("positions"), &pos_arr)?;
    Reflect::set(&obj, &JsValue::from_str("cells"), &cell_arr)?;
    
    Reflect::set(&obj, &JsValue::from_str("positionsLength"), &JsValue::from((vertices.len() / 3) as u32))?;
    Reflect::set(&obj, &JsValue::from_str("cellsLength"), &JsValue::from((faces.len() / 3) as u32))?;

    Ok(obj)
}
