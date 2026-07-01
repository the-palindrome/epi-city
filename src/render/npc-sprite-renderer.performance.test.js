import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { NPC_CONFIG } from '../core/constants.js'
import { createNpcSpriteState } from './npc-sprite.js'
import { createNpcSpriteRenderer } from './npc-sprite-renderer.js'

const COLORS = Object.freeze([0xe5c748, 0xf0a33a, 0xdb3b34, 0x49b86e])
const FACINGS = Object.freeze(['south', 'east', 'north', 'west'])

function createNpcBatch(count, city) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    present: true,
    position: {
      x: (index + 0.5) * city.tileSize,
      y: city.tileSize / 2
    },
    sprite: createNpcSpriteState(index),
    infection: 'susceptible'
  }))
}

function createMockPixi() {
  return {
    ParticleContainer: class {
      constructor(options = {}) {
        this.texture = options.texture
        this.dynamicProperties = options.dynamicProperties
        this.roundPixels = options.roundPixels
        this.particleChildren = options.particles || []
      }

      update() {}

      destroy() {}
    },
    Particle: class {
      constructor(options = {}) {
        Object.assign(this, options)
      }
    }
  }
}

function createTextureAtlas(colors) {
  const textures = []
  const colorIndexes = new Map(colors.map((color, index) => [color, index]))

  for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
    for (let facingIndex = 0; facingIndex < FACINGS.length; facingIndex += 1) {
      for (let frame = 0; frame < 4; frame += 1) {
        const slot = colorIndex * 16 + facingIndex * 4 + frame

        textures[slot] = { slot }
      }
    }
  }

  return {
    atlasTexture: { atlas: true },
    textures,
    colorIndexes,
    defaultSlot: 0,
    defaultTexture: textures[0]
  }
}

function createInfection(colors) {
  return {
    getNpcColor(npc) {
      return colors[npc.id % colors.length]
    }
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

describe('NPC sprite rendering performance', () => {
  it('profiles batched NPC particle updates', () => {
    const count = 800
    const frames = 80
    const city = {
      width: count,
      height: 1,
      tileSize: 32,
      tiles: Array.from({ length: count }, () => ({}))
    }
    const config = {
      ...NPC_CONFIG,
      maxVisiblePerTile: 1,
      visualSlotCount: 1
    }
    const npcs = createNpcBatch(count, city)
    const infection = createInfection(COLORS)
    const renderer = createNpcSpriteRenderer(npcs, city, config, infection, {
      pixi: createMockPixi(),
      textureAtlas: createTextureAtlas(COLORS)
    })

    renderer.render()

    const optimized = measureBest(() => {
      let visibleCount = 0

      for (let frame = 0; frame < frames; frame += 1) {
        renderer.render()
        visibleCount += renderer.display.particleChildren.length
      }

      return visibleCount
    }, 4)

    expect(optimized.value).toBe(count * frames)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('NPC batched particle render', optimized)

    renderer.destroy()
  }, 30000)
})
