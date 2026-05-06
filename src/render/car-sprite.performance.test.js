import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { CAR_CONFIG } from '../core/constants.js'
import {
  createCarSpriteRenderer,
  drawCarSprite
} from './car-sprite.js'

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

function createCountingGraphics() {
  return {
    rectCount: 0,
    fillCount: 0,
    clear() {
      this.rectCount = 0
      this.fillCount = 0
    },
    rect() {
      this.rectCount += 1
      return {
        fill: () => {
          this.fillCount += 1
        }
      }
    }
  }
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

describe('car sprite rendering performance', () => {
  it('updates pooled sprites at least 10x faster than redrawing procedural graphics rectangles', () => {
    const cars = createCarBatch(1000)
    const frames = 120
    const legacyGraphics = createCountingGraphics()
    const renderer = createCarSpriteRenderer(cars, CITY, CAR_CONFIG, {
      pixi: createMockPixi(),
      textureFactory: createTextureFactory()
    })

    renderer.render(cars)

    const legacy = measureBest(() => {
      let fillCount = 0

      for (let frame = 0; frame < frames; frame += 1) {
        legacyGraphics.clear()

        for (const car of cars) {
          drawCarSprite(legacyGraphics, car, CITY, CAR_CONFIG)
        }

        fillCount += legacyGraphics.fillCount
      }

      return fillCount
    })
    const optimized = measureBest(() => {
      let visibleCount = 0

      for (let frame = 0; frame < frames; frame += 1) {
        renderer.render(cars)
        visibleCount += renderer.sprites.length
      }

      return visibleCount
    })
    const speedup = legacy.ms / Math.max(optimized.ms, 0.001)

    expect(legacy.value).toBeGreaterThan(cars.length * frames * 20)
    expect(optimized.value).toBe(cars.length * frames)
    expect(speedup).toBeGreaterThanOrEqual(10)

    renderer.destroy()
  }, 30000)
})
