import { describe, it, expect } from 'vitest'
import {
  linearInterpolate3d,
  getInterpolatedShape,
  type Shape3
} from './linearInterpolate3D'

describe('getInterpolatedShape', () => {
  it('level=1 时输出尺寸与输入一致', () => {
    expect(getInterpolatedShape([5, 6, 7], 1)).toEqual([5, 6, 7])
  })

  it('level=2 时每维为 (n-1)*2+1', () => {
    expect(getInterpolatedShape([3, 4, 5], 2)).toEqual([5, 7, 9])
  })

  it('level=3 时正确计算', () => {
    expect(getInterpolatedShape([2, 2, 2], 3)).toEqual([4, 4, 4])
  })
})

describe('linearInterpolate3d', () => {
  it('level=1 时输出与输入逐元素相等', () => {
    const shape: Shape3 = [2, 3, 2]
    const n = 2 * 3 * 2
    const data = new Float64Array(n)
    for (let i = 0; i < n; i++) data[i] = i + 0.5
    const out = linearInterpolate3d(data, shape, 1)
    expect(out.length).toBe(n)
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBe(data[i])
    }
  })

  it('常值场插值后仍为常值', () => {
    const shape: Shape3 = [3, 3, 3]
    const data = new Float64Array(27)
    data.fill(7.5)
    const out = linearInterpolate3d(data, shape, 2)
    expect(out.length).toBe(5 * 5 * 5)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(7.5)
    }
  })

  it('2×2×2 角点保持原值', () => {
    const shape: Shape3 = [2, 2, 2]
    const data = new Float64Array(8)
    data[0] = 0
    data[1] = 1
    data[2] = 2
    data[3] = 3
    data[4] = 4
    data[5] = 5
    data[6] = 6
    data[7] = 7
    const out = linearInterpolate3d(data, shape, 1)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(1)
    expect(out[2]).toBe(2)
    expect(out[3]).toBe(3)
    expect(out[4]).toBe(4)
    expect(out[5]).toBe(5)
    expect(out[6]).toBe(6)
    expect(out[7]).toBe(7)
  })

  it('2×2×2 level=2 时体中心为 8 顶点平均', () => {
    const shape: Shape3 = [2, 2, 2]
    const data = new Float64Array(8)
    for (let i = 0; i < 8; i++) data[i] = i
    const out = linearInterpolate3d(data, shape, 2)
    const outShape = getInterpolatedShape(shape, 2)
    const [ox, oy, oz] = outShape
    const centerIdx = Math.floor(oz / 2) * ox * oy + Math.floor(oy / 2) * ox + Math.floor(ox / 2)
    const center = out[centerIdx]
    const expectedMean = (0 + 1 + 2 + 3 + 4 + 5 + 6 + 7) / 8
    expect(center).toBe(expectedMean)
  })

  it('一维线性：两格点中间为平均', () => {
    const shape: Shape3 = [2, 1, 1]
    const data = new Float64Array(2)
    data[0] = 0
    data[1] = 10
    const out = linearInterpolate3d(data, shape, 2)
    expect(out.length).toBe(3)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(5)
    expect(out[2]).toBe(10)
  })

  it('输出长度等于 outNx * outNy * outNz', () => {
    const shape: Shape3 = [4, 5, 6]
    const data = new Float64Array(4 * 5 * 6)
    const level = 3
    const out = linearInterpolate3d(data, shape, level)
    const [ox, oy, oz] = getInterpolatedShape(shape, level)
    expect(out.length).toBe(ox * oy * oz)
  })

  it('单格点 shape=[1,1,1] level=1 输出单元素', () => {
    const shape: Shape3 = [1, 1, 1]
    const data = new Float64Array([42])
    const out = linearInterpolate3d(data, shape, 1)
    expect(out.length).toBe(1)
    expect(out[0]).toBe(42)
  })
})
