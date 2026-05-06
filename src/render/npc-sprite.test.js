import { describe, expect, it } from 'vitest'
import {
  createNpcSpriteState,
  drawNpcSprite,
  getNpcSpriteFrame,
  idleNpcSprite,
  NPC_SPRITE_FRAME_DISTANCE,
  npcSpriteFacingFromVector,
  stepNpcSpriteAnimation
} from './npc-sprite.js'

function createGraphics() {
  return {
    fills: [],
    rect(x, y, width, height) {
      return {
        fill: (options) => {
          this.fills.push({ x, y, width, height, ...options })
        }
      }
    }
  }
}

describe('NPC sprite rendering', () => {
  it('faces the dominant movement axis', () => {
    expect(npcSpriteFacingFromVector(1, 0.2)).toBe('east')
    expect(npcSpriteFacingFromVector(-1, 0.2)).toBe('west')
    expect(npcSpriteFacingFromVector(0.1, 1)).toBe('south')
    expect(npcSpriteFacingFromVector(0.1, -1)).toBe('north')
    expect(npcSpriteFacingFromVector(0, 0)).toBeNull()
  })

  it('advances walking frames by movement distance and idles on demand', () => {
    const npc = {
      id: 0,
      sprite: createNpcSpriteState(0)
    }

    stepNpcSpriteAnimation(npc, 1, 0, NPC_SPRITE_FRAME_DISTANCE)

    expect(npc.sprite.facing).toBe('east')
    expect(npc.sprite.walking).toBe(true)
    expect(getNpcSpriteFrame(npc.sprite)).toBe(1)

    idleNpcSprite(npc)

    expect(npc.sprite.walking).toBe(false)
    expect(getNpcSpriteFrame(npc.sprite)).toBe(0)
  })

  it('draws a status-colored top-down pedestrian sprite', () => {
    const graphics = createGraphics()
    const npc = {
      id: 2,
      position: { x: 32, y: 48 },
      sprite: {
        facing: 'south',
        walking: true,
        walkDistance: NPC_SPRITE_FRAME_DISTANCE
      }
    }

    drawNpcSprite(graphics, npc, { color: 0x123456, size: 9 })

    expect(graphics.fills.length).toBeGreaterThan(16)
    expect(graphics.fills.some((fill) => fill.color === 0x123456)).toBe(true)
    expect(graphics.fills.some((fill) => fill.alpha < 1)).toBe(true)
  })

  it('renders larger than the old nine-pixel blob footprint with a contrast rim', () => {
    const graphics = createGraphics()
    const npc = {
      id: 1,
      position: { x: 32, y: 48 },
      sprite: {
        facing: 'south',
        walking: false,
        walkDistance: 0
      }
    }

    drawNpcSprite(graphics, npc, { color: 0xe5c748, size: 9 })

    const bounds = graphics.fills.reduce((box, fill) => ({
      minX: Math.min(box.minX, fill.x),
      minY: Math.min(box.minY, fill.y),
      maxX: Math.max(box.maxX, fill.x + fill.width),
      maxY: Math.max(box.maxY, fill.y + fill.height)
    }), {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    })

    expect(bounds.maxX - bounds.minX).toBeGreaterThan(9)
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(13)
    expect(graphics.fills.some((fill) => fill.alpha === 0.42)).toBe(true)
  })
})
