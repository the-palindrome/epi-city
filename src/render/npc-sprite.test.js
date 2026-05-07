import { describe, expect, it } from 'vitest'
import {
  createNpcSpriteState,
  drawNpcSprite,
  faceNpcSprite,
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

function createFillReferenceGraphics() {
  return {
    fillOptions: [],
    rect() {
      return this
    },
    fill(options) {
      this.fillOptions.push(options)
      return this
    }
  }
}

const REFERENCE_DEFAULT_NPC_SIZE = 9
const REFERENCE_MIN_SPRITE_PIXEL = 1
const REFERENCE_DRAW_SCALE = 1.28
const REFERENCE_OUTLINE_COLOR = 0x17130f
const REFERENCE_SHOE_COLOR = 0x24201d
const REFERENCE_HAIR_COLOR = 0x2f2318
const REFERENCE_SKIN_COLOR = 0xe8b579
const REFERENCE_SHADOW_COLOR = 0x000000

function drawNpcSpriteUncachedReference(graphics, npc, { color, size = REFERENCE_DEFAULT_NPC_SIZE } = {}) {
  if (!graphics || !npc?.position) {
    return
  }

  const sprite = npc.sprite || createNpcSpriteState(npc.id)
  const pixel = Math.max(REFERENCE_MIN_SPRITE_PIXEL, (size / REFERENCE_DEFAULT_NPC_SIZE) * REFERENCE_DRAW_SCALE)
  const facing = sprite.facing || 'south'
  const frame = getNpcSpriteFrame(sprite)
  const palette = createUncachedReferencePalette(color)

  drawUncachedReferenceVerticalNpcSprite(graphics, npc.position.x, npc.position.y, pixel, facing, frame, palette)
}

function createUncachedReferencePalette(color) {
  const status = normalizeReferenceColor(color)

  return {
    status,
    statusDark: mixReferenceColor(status, REFERENCE_OUTLINE_COLOR, 0.28),
    statusLight: mixReferenceColor(status, 0xffffff, 0.36),
    rim: mixReferenceColor(status, 0xffffff, 0.68),
    outline: REFERENCE_OUTLINE_COLOR,
    shoe: REFERENCE_SHOE_COLOR,
    hair: REFERENCE_HAIR_COLOR,
    skin: REFERENCE_SKIN_COLOR,
    skinDark: mixReferenceColor(REFERENCE_SKIN_COLOR, REFERENCE_OUTLINE_COLOR, 0.18),
    shadow: REFERENCE_SHADOW_COLOR
  }
}

function drawUncachedReferenceVerticalNpcSprite(graphics, x, y, pixel, facing, frame, palette) {
  const originX = Math.round(x - (9 * pixel) / 2)
  const originY = Math.round(y - (13 * pixel) / 2)
  const stride = referenceWalkStride(frame)
  const leftStep = stride
  const rightStep = -stride

  referenceSpriteRect(graphics, originX, originY, pixel, 1, 2, 7, 8, palette.rim, 0.42)
  referenceSpriteRect(graphics, originX, originY, pixel, 1, -1, 7, 6, palette.rim, 0.32)
  referenceSpriteRect(graphics, originX, originY, pixel, 0, 11, 9, 3, palette.shadow, 0.34)
  drawUncachedReferenceVerticalLeg(graphics, originX, originY, pixel, 3, leftStep, palette)
  drawUncachedReferenceVerticalLeg(graphics, originX, originY, pixel, 5, rightStep, palette)

  drawUncachedReferenceVerticalArm(graphics, originX, originY, pixel, 1, -leftStep, palette)
  drawUncachedReferenceVerticalArm(graphics, originX, originY, pixel, 6, -rightStep, palette)

  referenceSpriteRect(graphics, originX, originY, pixel, 2, 3, 5, 6, palette.outline)
  referenceSpriteRect(graphics, originX, originY, pixel, 3, 4, 3, 4, palette.status)
  referenceSpriteRect(graphics, originX, originY, pixel, 3, 4, 3, 1, palette.statusLight)
  referenceSpriteRect(graphics, originX, originY, pixel, 2, 7, 5, 2, palette.statusDark)

  referenceSpriteRect(graphics, originX, originY, pixel, 2, 0, 5, 4, palette.outline)

  if (facing === 'north') {
    referenceSpriteRect(graphics, originX, originY, pixel, 3, 1, 3, 2, palette.hair)
    referenceSpriteRect(graphics, originX, originY, pixel, 2, 0, 5, 2, palette.hair)
  } else {
    referenceSpriteRect(graphics, originX, originY, pixel, 3, 1, 3, 2, palette.skin)
    referenceSpriteRect(graphics, originX, originY, pixel, 2, 0, 5, 1, palette.hair)
    referenceSpriteRect(graphics, originX, originY, pixel, 3, 3, 3, 1, palette.skinDark)
  }
}

function drawUncachedReferenceVerticalLeg(graphics, originX, originY, pixel, x, step, palette) {
  const y = 8 + step

  referenceSpriteRect(graphics, originX, originY, pixel, x - 1, y, 3, 4, palette.outline)
  referenceSpriteRect(graphics, originX, originY, pixel, x, y, 1, 3, palette.statusDark)
  referenceSpriteRect(graphics, originX, originY, pixel, x - 1, y + 3, 3, 1, palette.shoe)
}

function drawUncachedReferenceVerticalArm(graphics, originX, originY, pixel, x, step, palette) {
  const y = 5 + step

  referenceSpriteRect(graphics, originX, originY, pixel, x, y, 2, 4, palette.outline)
  referenceSpriteRect(graphics, originX, originY, pixel, x, y + 1, 1, 2, palette.statusDark)
  referenceSpriteRect(graphics, originX, originY, pixel, x, y + 3, 1, 1, palette.skin)
}

function referenceWalkStride(frame) {
  if (frame === 1) {
    return -1
  }

  if (frame === 3) {
    return 1
  }

  return 0
}

function referenceSpriteRect(graphics, originX, originY, pixel, x, y, width, height, color, alpha = 1) {
  graphics
    .rect(
      originX + x * pixel,
      originY + y * pixel,
      Math.max(1, width * pixel),
      Math.max(1, height * pixel)
    )
    .fill({ color, alpha })
}

function normalizeReferenceColor(color) {
  return Number.isInteger(color) ? color & 0xffffff : 0xe5c748
}

function mixReferenceColor(color, target, amount) {
  const clampedAmount = Math.min(Math.max(amount, 0), 1)
  const inverse = 1 - clampedAmount
  const red = Math.round(((color >> 16) & 0xff) * inverse + ((target >> 16) & 0xff) * clampedAmount)
  const green = Math.round(((color >> 8) & 0xff) * inverse + ((target >> 8) & 0xff) * clampedAmount)
  const blue = Math.round((color & 0xff) * inverse + (target & 0xff) * clampedAmount)

  return (red << 16) | (green << 8) | blue
}

function createSpriteBatch(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    position: {
      x: 32 + (index % 20) * 3,
      y: 48 + Math.floor(index / 20) * 2
    },
    sprite: {
      facing: 'south',
      walking: true,
      walkDistance: NPC_SPRITE_FRAME_DISTANCE
    }
  }))
}

function drawSpriteBatch(graphics, npcs, drawSprite, color) {
  for (const npc of npcs) {
    drawSprite(graphics, npc, { color, size: 9 })
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

  it('keeps a stable facing during near-diagonal movement jitter', () => {
    const npc = {
      id: 0,
      sprite: {
        ...createNpcSpriteState(0),
        facing: 'east'
      }
    }

    faceNpcSprite(npc, 0.71, 0.7)
    expect(npc.sprite.facing).toBe('east')

    faceNpcSprite(npc, 0.69, 0.72)
    expect(npc.sprite.facing).toBe('east')

    faceNpcSprite(npc, 0.45, 0.89)
    expect(npc.sprite.facing).toBe('south')

    faceNpcSprite(npc, -0.89, 0.45)
    expect(npc.sprite.facing).toBe('west')
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

  it('reuses cached palette fill styles across same-color NPC draws', () => {
    const color = 0x3366aa
    const npc = {
      id: 7,
      position: { x: 32, y: 48 },
      sprite: {
        facing: 'south',
        walking: true,
        walkDistance: NPC_SPRITE_FRAME_DISTANCE
      }
    }
    const cachedGraphics = createGraphics()
    const referenceGraphics = createGraphics()

    drawNpcSprite(cachedGraphics, npc, { color, size: 9 })
    drawNpcSpriteUncachedReference(referenceGraphics, npc, { color, size: 9 })

    expect(cachedGraphics.fills).toEqual(referenceGraphics.fills)

    const npcs = createSpriteBatch(80)
    const cachedReferenceGraphics = createFillReferenceGraphics()
    const uncachedReferenceGraphics = createFillReferenceGraphics()

    drawSpriteBatch(cachedReferenceGraphics, npcs, drawNpcSprite, color)
    drawSpriteBatch(uncachedReferenceGraphics, npcs, drawNpcSpriteUncachedReference, color)

    const cachedUniqueFillStyles = new Set(cachedReferenceGraphics.fillOptions).size
    const uncachedUniqueFillStyles = new Set(uncachedReferenceGraphics.fillOptions).size

    expect(cachedReferenceGraphics.fillOptions).toHaveLength(uncachedReferenceGraphics.fillOptions.length)
    expect(uncachedUniqueFillStyles).toBeGreaterThanOrEqual(cachedUniqueFillStyles * 10)
  })
})
