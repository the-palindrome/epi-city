import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  normalizeRgbaFramePayload,
  RGBA_BYTES_PER_PIXEL
} from './video-frame-transport.js'

const WIDTH = 640
const HEIGHT = 360
const FRAMES = 6

function createNoisyRgbaFrame(width, height) {
  const pixels = new Uint8ClampedArray(width * height * RGBA_BYTES_PER_PIXEL)
  let state = 0x12345678

  for (let index = 0; index < pixels.length; index += RGBA_BYTES_PER_PIXEL) {
    state = (1664525 * state + 1013904223) >>> 0
    pixels[index] = state & 0xff
    pixels[index + 1] = (state >>> 8) & 0xff
    pixels[index + 2] = (state >>> 16) & 0xff
    pixels[index + 3] = 0xff
  }

  return pixels
}

function measure(fn) {
  const start = performance.now()
  const value = fn()

  return {
    value,
    ms: performance.now() - start
  }
}

function measureBest(fn, attempts = 4) {
  fn()

  let best = { value: null, ms: Infinity }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = measure(fn)

    if (result.ms < best.ms) {
      best = result
    }
  }

  return best
}

function recordMeasurement(label, measurement) {
  process.stdout.write(`[perf] ${label}: ${measurement.ms.toFixed(3)}ms\n`)
}

describe('video frame transport performance', () => {
  it('profiles raw RGBA frame normalization', () => {
    const pixels = createNoisyRgbaFrame(WIDTH, HEIGHT)
    const optimized = measureBest(() => {
      let byteCount = 0

      for (let frame = 0; frame < FRAMES; frame += 1) {
        const { buffer } = normalizeRgbaFramePayload({
          width: WIDTH,
          height: HEIGHT,
          origin: 'bottom-left',
          pixels
        }, {
          width: WIDTH,
          height: HEIGHT,
          origin: 'bottom-left'
        })

        byteCount += buffer.length
      }

      return byteCount
    })

    expect(optimized.value).toBe(WIDTH * HEIGHT * RGBA_BYTES_PER_PIXEL * FRAMES)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('raw RGBA frame normalization', optimized)
  }, 30000)
})
