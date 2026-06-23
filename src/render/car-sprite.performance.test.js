import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { CAR_CONFIG } from '../core/constants.js'
import { createCarSpriteRenderer } from './car-sprite.js'

const CITY = Object.freeze({ tileSize: 32 })
const DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 0, dy: -1 })
])

function createCarBatch(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    color: CAR_CONFIG.colorPalette[index % CAR_CONFIG.colorPalette.length],
    lengthTiles: index % 5 === 0 ? 3 : 2,
    direction: DIRECTIONS[index % DIRECTIONS.length],
    position: {
      x: 32 + (index % 80) * 8,
      y: 48 + Math.floor(index / 80) * 7
    }
  }))
}

function createMockPixi() {
  return {
    Container: class {
      constructor() {
        this.children = []
      }

      addChild(child) {
        this.children.push(child)
        child.parent = this
      }

      removeChild(child) {
        this.children = this.children.filter((item) => item !== child)
        child.parent = null
      }

      destroy() {}
    },
    Sprite: class {
      constructor() {
        this.anchor = {
          set: (value) => {
            this.anchorValue = value
          }
        }
        this.visible = false
        this.texture = null
        this.x = 0
        this.y = 0
      }

      destroy() {}
    }
  }
}

function createTextureFactory() {
  const textures = new Map()

  return (key) => {
    let texture = textures.get(key)

    if (!texture) {
      texture = { key }
      textures.set(key, texture)
    }

    return texture
  }
}

function measure(fn) {
  const start = performance.now()
  const value = fn()

  return {
    value,
    ms: performance.now() - start
  }
}

function measureBest(fn, attempts = 5) {
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

describe('car sprite rendering performance', () => {
  it('profiles pooled sprite updates', () => {
    const cars = createCarBatch(1000)
    const frames = 120
    const renderer = createCarSpriteRenderer(cars, CITY, CAR_CONFIG, {
      pixi: createMockPixi(),
      textureFactory: createTextureFactory()
    })

    renderer.render(cars)

    const optimized = measureBest(() => {
      let visibleCount = 0

      for (let frame = 0; frame < frames; frame += 1) {
        renderer.render(cars)
        visibleCount += renderer.sprites.length
      }

      return visibleCount
    })

    expect(optimized.value).toBe(cars.length * frames)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('car sprite pooled render', optimized)

    renderer.destroy()
  }, 30000)
})
