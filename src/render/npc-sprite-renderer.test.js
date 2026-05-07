import { describe, expect, it } from 'vitest'
import { INFECTION_CONFIG, NPC_CONFIG } from '../core/constants.js'
import { NPC_SPRITE_FRAME_DISTANCE, createNpcSpriteState } from './npc-sprite.js'
import { createNpcSpriteRenderer } from './npc-sprite-renderer.js'

const FACINGS = Object.freeze(['south', 'east', 'north', 'west'])

function createMockPixi() {
  return {
    ParticleContainer: class {
      constructor(options = {}) {
        this.texture = options.texture
        this.dynamicProperties = options.dynamicProperties
        this.roundPixels = options.roundPixels
        this.particleChildren = options.particles || []
        this.updateCount = 0
      }

      update() {
        this.updateCount += 1
      }

      destroy() {
        this.destroyed = true
      }
    },
    Particle: class {
      constructor(options = {}) {
        Object.assign(this, options)
      }
    }
  }
}

function createRenderModeMockPixi() {
  return {
    ...createMockPixi(),
    Container: class {
      constructor() {
        this.children = []
        this.visible = true
      }

      addChild(child) {
        this.children.push(child)
        child.parent = this
      }

      removeChild(child) {
        this.children = this.children.filter((item) => item !== child)
        child.parent = null
      }

      destroy() {
        this.destroyed = true
      }
    },
    Graphics: class {
      constructor() {
        this.circles = []
        this.circleStrokes = []
        this.strokes = []
        this.path = []
        this.visible = true
      }

      clear() {
        this.circles = []
        this.circleStrokes = []
        this.strokes = []
        this.path = []
      }

      circle(x, y, radius) {
        return {
          fill: (style) => {
            this.circles.push({ x, y, radius, ...style })
          },
          stroke: (style) => {
            this.circleStrokes.push({ x, y, radius, ...style })
          }
        }
      }

      moveTo(x, y) {
        this.path.push({ type: 'moveTo', x, y })
        return this
      }

      lineTo(x, y) {
        this.path.push({ type: 'lineTo', x, y })
        return this
      }

      stroke(style) {
        this.strokes.push({ path: [...this.path], ...style })
        this.path = []
        return this
      }

      destroy() {
        this.destroyed = true
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

        textures[slot] = { slot, color: colors[colorIndex], facing: FACINGS[facingIndex], frame }
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

function createNpc(id, x, y) {
  return {
    id,
    present: true,
    position: { x, y },
    sprite: createNpcSpriteState(id)
  }
}

describe('NPC sprite renderer', () => {
  it('compacts visible NPCs into reusable particles and honors tile visibility caps', () => {
    const city = {
      width: 1,
      height: 1,
      tileSize: 32,
      tiles: [{}]
    }
    const colors = [0x111111, 0x222222]
    const npcs = [
      createNpc(0, 16, 16),
      createNpc(1, 18, 16),
      createNpc(2, 20, 16),
      createNpc(3, 22, 16)
    ]
    const infection = {
      getNpcColor(npc) {
        return colors[npc.id % colors.length]
      }
    }
    const renderer = createNpcSpriteRenderer(npcs, city, {
      ...NPC_CONFIG,
      maxVisiblePerTile: 2,
      tileCapacity: 4
    }, infection, {
      pixi: createMockPixi(),
      textureAtlas: createTextureAtlas(colors)
    })

    renderer.render()

    expect(renderer.display.particleChildren).toHaveLength(2)
    expect(renderer.display.updateCount).toBe(1)
    expect(renderer.display.particleChildren[0]).toBe(renderer.particles[0])
    expect(renderer.display.particleChildren[1]).toBe(renderer.particles[1])
    expect(renderer.particles[0]).toMatchObject({ x: 16, y: 16 })
    expect(renderer.particles[1]).toMatchObject({ x: 18, y: 16 })

    const firstParticle = renderer.particles[0]

    npcs[0].position.x = 19
    npcs[0].sprite.facing = 'east'
    npcs[0].sprite.walking = true
    npcs[0].sprite.walkDistance = NPC_SPRITE_FRAME_DISTANCE
    renderer.render()

    expect(renderer.display.particleChildren[0]).toBe(firstParticle)
    expect(firstParticle.x).toBe(19)
    expect(firstParticle.texture).toMatchObject({
      color: colors[0],
      facing: 'east',
      frame: 1
    })

    renderer.destroy()

    expect(renderer.display.particleChildren).toHaveLength(0)
    expect(renderer.display.destroyed).toBe(true)
  })

  it('switches to geometric disks colored by infection state', () => {
    const city = {
      width: 2,
      height: 1,
      tileSize: 32,
      tiles: [{}, {}]
    }
    const colors = [0xe5c748, 0xf0a33a]
    const npcs = [
      createNpc(0, 16, 16),
      createNpc(1, 48, 16)
    ]
    const infection = {
      getNpcColor(npc) {
        return colors[npc.id]
      }
    }
    const renderer = createNpcSpriteRenderer(npcs, city, {
      ...NPC_CONFIG,
      entityRenderMode: 'geometric'
    }, infection, {
      pixi: createRenderModeMockPixi(),
      textureAtlas: createTextureAtlas(colors)
    })

    renderer.render()

    const spriteDisplay = renderer.display.children[0]
    const geometricDisplay = renderer.display.children[1]

    expect(renderer.renderMode).toBe('geometric')
    expect(spriteDisplay.visible).toBe(false)
    expect(geometricDisplay.visible).toBe(true)
    expect(geometricDisplay.circles).toEqual([
      expect.objectContaining({ x: 16, y: 16, color: colors[0], alpha: 1 }),
      expect.objectContaining({ x: 48, y: 16, color: colors[1], alpha: 1 })
    ])

    renderer.setRenderMode('sprite')
    renderer.render()

    expect(renderer.renderMode).toBe('sprite')
    expect(spriteDisplay.visible).toBe(true)
    expect(geometricDisplay.visible).toBe(false)
    expect(spriteDisplay.particleChildren).toHaveLength(2)

    renderer.destroy()
  })

  it('draws infection radius, transmission edges, and NPC path trails as overlays', () => {
    const city = {
      width: 2,
      height: 1,
      tileSize: 32,
      tiles: [{}, {}]
    }
    const colors = [0xdb3b34, 0xf0a33a]
    const npcs = [
      { ...createNpc(0, 16, 16), infection: 'infectious' },
      { ...createNpc(1, 48, 16), infection: 'exposed' }
    ]
    const clock = {
      seconds: 0,
      getElapsedSimulationSeconds() {
        return this.seconds
      }
    }
    const infection = {
      infectionDistance: 24,
      getNpcColor(npc) {
        return colors[npc.id]
      }
    }
    const renderer = createNpcSpriteRenderer(npcs, city, {
      ...NPC_CONFIG,
      entityRenderMode: 'geometric'
    }, infection, {
      pixi: createRenderModeMockPixi(),
      textureAtlas: createTextureAtlas(colors),
      clock,
      entityDebugOptions: {
        infectionRadiusVisible: true,
        infectionEdgesVisible: true,
        infectionEdgeDurationSeconds: 3600,
        pathTrailsVisible: true,
        pathTrailLength: 2
      },
      getTransmissionEvents: () => [{
        id: 1,
        simulationSeconds: 0,
        sourceNpcId: 0,
        targetNpcId: 1,
        sourcePosition: { x: 16, y: 16 },
        targetPosition: { x: 48, y: 16 }
      }]
    })

    renderer.render()
    npcs[0].position = { x: 24, y: 16 }
    npcs[1].position = { x: 56, y: 16 }
    clock.seconds = 60
    renderer.render()

    const overlay = renderer.display.children[2]

    expect(overlay.circleStrokes).toEqual([
      expect.objectContaining({ x: 24, y: 16, radius: 24, color: colors[0] })
    ])
    expect(overlay.strokes.some((stroke) => stroke.color === INFECTION_CONFIG.colors.infectious)).toBe(true)
    expect(overlay.strokes.some((stroke) => stroke.color === colors[0])).toBe(true)
    expect(overlay.strokes.some((stroke) => stroke.color === colors[1])).toBe(true)

    renderer.setDebugOptions({ infectionRadiusVisible: false, infectionEdgesVisible: false, pathTrailsVisible: false })
    renderer.render()

    expect(overlay.circleStrokes).toEqual([])
    expect(overlay.strokes).toEqual([])

    renderer.destroy()
  })
})
