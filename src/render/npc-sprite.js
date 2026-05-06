export const NPC_SPRITE_FRAME_DISTANCE = 4
export const NPC_SPRITE_FRAME_COUNT = 4

const NPC_SPRITE_CYCLE_DISTANCE = NPC_SPRITE_FRAME_DISTANCE * NPC_SPRITE_FRAME_COUNT
const DEFAULT_NPC_SIZE = 9
const MIN_SPRITE_PIXEL = 1
const NPC_SPRITE_DRAW_SCALE = 1.28
const OUTLINE_COLOR = 0x17130f
const SHOE_COLOR = 0x24201d
const HAIR_COLOR = 0x2f2318
const SKIN_COLOR = 0xe8b579
const SHADOW_COLOR = 0x000000
const SKIN_DARK_COLOR = mixColor(SKIN_COLOR, OUTLINE_COLOR, 0.18)

const STATIC_NPC_FILL_STYLES = {
  outline: createFillStyle(OUTLINE_COLOR),
  shoe: createFillStyle(SHOE_COLOR),
  hair: createFillStyle(HAIR_COLOR),
  skin: createFillStyle(SKIN_COLOR),
  skinDark: createFillStyle(SKIN_DARK_COLOR),
  shadow: createFillStyle(SHADOW_COLOR, 0.34)
}
const NPC_SPRITE_PALETTE_CACHE = new Map()

export function createNpcSpriteState(id = 0) {
  const safeId = Number.isInteger(id) ? Math.max(0, id) : 0

  return {
    facing: ['south', 'east', 'north', 'west'][safeId % 4],
    walking: false,
    walkDistance: (safeId % NPC_SPRITE_FRAME_COUNT) * NPC_SPRITE_FRAME_DISTANCE
  }
}

export function faceNpcSprite(npc, directionX, directionY) {
  const sprite = ensureNpcSpriteState(npc)
  const facing = npcSpriteFacingFromVector(directionX, directionY)

  if (facing) {
    sprite.facing = facing
  }
}

export function stepNpcSpriteAnimation(npc, directionX, directionY, distance) {
  const sprite = ensureNpcSpriteState(npc)
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0

  faceNpcSprite(npc, directionX, directionY)

  if (safeDistance === 0) {
    sprite.walking = false
    return
  }

  sprite.walking = true
  sprite.walkDistance = (sprite.walkDistance + safeDistance) % NPC_SPRITE_CYCLE_DISTANCE
}

export function idleNpcSprite(npc) {
  ensureNpcSpriteState(npc).walking = false
}

export function getNpcSpriteFrame(sprite) {
  if (!sprite?.walking) {
    return 0
  }

  return Math.floor(sprite.walkDistance / NPC_SPRITE_FRAME_DISTANCE) % NPC_SPRITE_FRAME_COUNT
}

export function getNpcSpriteMetrics({ size = DEFAULT_NPC_SIZE } = {}) {
  const pixel = Math.max(MIN_SPRITE_PIXEL, (size / DEFAULT_NPC_SIZE) * NPC_SPRITE_DRAW_SCALE)
  const textureSize = Math.ceil(16 * pixel + 8)

  return {
    pixel,
    textureWidth: textureSize,
    textureHeight: textureSize,
    centerX: Math.floor(textureSize / 2),
    centerY: Math.floor(textureSize / 2)
  }
}

export function npcSpriteFacingFromVector(directionX, directionY) {
  if (!Number.isFinite(directionX) || !Number.isFinite(directionY)) {
    return null
  }

  if (Math.abs(directionX) < 0.001 && Math.abs(directionY) < 0.001) {
    return null
  }

  if (Math.abs(directionX) >= Math.abs(directionY)) {
    return directionX >= 0 ? 'east' : 'west'
  }

  return directionY >= 0 ? 'south' : 'north'
}

export function drawNpcSprite(graphics, npc, { color, size = DEFAULT_NPC_SIZE } = {}) {
  if (!graphics || !npc?.position) {
    return
  }

  const sprite = npc.sprite || createNpcSpriteState(npc.id)
  const { pixel } = getNpcSpriteMetrics({ size })
  const facing = sprite.facing || 'south'
  const frame = getNpcSpriteFrame(sprite)
  const palette = getNpcSpritePalette(color)

  if (facing === 'east' || facing === 'west') {
    drawHorizontalNpcSprite(graphics, npc.position.x, npc.position.y, pixel, facing, frame, palette)
    return
  }

  drawVerticalNpcSprite(graphics, npc.position.x, npc.position.y, pixel, facing, frame, palette)
}

function ensureNpcSpriteState(npc) {
  if (!npc.sprite) {
    npc.sprite = createNpcSpriteState(npc.id)
  }

  return npc.sprite
}

function getNpcSpritePalette(color) {
  const status = normalizeColor(color)
  const cachedPalette = NPC_SPRITE_PALETTE_CACHE.get(status)

  if (cachedPalette) {
    return cachedPalette
  }

  const palette = createNpcSpritePalette(status)

  NPC_SPRITE_PALETTE_CACHE.set(status, palette)

  return palette
}

function createNpcSpritePalette(status) {
  const statusDark = mixColor(status, OUTLINE_COLOR, 0.28)
  const statusLight = mixColor(status, 0xffffff, 0.36)
  const rim = mixColor(status, 0xffffff, 0.68)

  return {
    status: createFillStyle(status),
    statusDark: createFillStyle(statusDark),
    statusLight: createFillStyle(statusLight),
    rimStrong: createFillStyle(rim, 0.42),
    rimSoft: createFillStyle(rim, 0.32),
    ...STATIC_NPC_FILL_STYLES
  }
}

function createFillStyle(color, alpha = 1) {
  return { color, alpha }
}

function drawVerticalNpcSprite(graphics, x, y, pixel, facing, frame, palette) {
  const originX = Math.round(x - (9 * pixel) / 2)
  const originY = Math.round(y - (13 * pixel) / 2)
  const stride = walkStride(frame)
  const leftStep = stride
  const rightStep = -stride

  spriteRect(graphics, originX, originY, pixel, 1, 2, 7, 8, palette.rimStrong)
  spriteRect(graphics, originX, originY, pixel, 1, -1, 7, 6, palette.rimSoft)
  spriteRect(graphics, originX, originY, pixel, 0, 11, 9, 3, palette.shadow)
  drawVerticalLeg(graphics, originX, originY, pixel, 3, leftStep, palette)
  drawVerticalLeg(graphics, originX, originY, pixel, 5, rightStep, palette)

  drawVerticalArm(graphics, originX, originY, pixel, 1, -leftStep, palette)
  drawVerticalArm(graphics, originX, originY, pixel, 6, -rightStep, palette)

  spriteRect(graphics, originX, originY, pixel, 2, 3, 5, 6, palette.outline)
  spriteRect(graphics, originX, originY, pixel, 3, 4, 3, 4, palette.status)
  spriteRect(graphics, originX, originY, pixel, 3, 4, 3, 1, palette.statusLight)
  spriteRect(graphics, originX, originY, pixel, 2, 7, 5, 2, palette.statusDark)

  spriteRect(graphics, originX, originY, pixel, 2, 0, 5, 4, palette.outline)

  if (facing === 'north') {
    spriteRect(graphics, originX, originY, pixel, 3, 1, 3, 2, palette.hair)
    spriteRect(graphics, originX, originY, pixel, 2, 0, 5, 2, palette.hair)
  } else {
    spriteRect(graphics, originX, originY, pixel, 3, 1, 3, 2, palette.skin)
    spriteRect(graphics, originX, originY, pixel, 2, 0, 5, 1, palette.hair)
    spriteRect(graphics, originX, originY, pixel, 3, 3, 3, 1, palette.skinDark)
  }
}

function drawHorizontalNpcSprite(graphics, x, y, pixel, facing, frame, palette) {
  const originX = Math.round(x - (13 * pixel) / 2)
  const originY = Math.round(y - (9 * pixel) / 2)
  const mirror = facing === 'west'
  const stride = walkStride(frame)
  const topStep = stride
  const bottomStep = -stride

  spriteRect(graphics, originX, originY, pixel, 3, 1, 7, 7, palette.rimStrong)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 7, 0, 6, 7, palette.rimSoft)
  spriteRect(graphics, originX, originY, pixel, 1, 7, 11, 3, palette.shadow)
  drawHorizontalLeg(graphics, originX, originY, pixel, 3, topStep, mirror, palette)
  drawHorizontalLeg(graphics, originX, originY, pixel, 5, bottomStep, mirror, palette)

  drawHorizontalArm(graphics, originX, originY, pixel, 2, -topStep, mirror, palette)
  drawHorizontalArm(graphics, originX, originY, pixel, 6, -bottomStep, mirror, palette)

  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 4, 2, 5, 5, palette.outline)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 5, 3, 3, 3, palette.status)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 5, 3, 1, 3, palette.statusLight)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 4, 5, 5, 2, palette.statusDark)

  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 8, 1, 4, 5, palette.outline)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 9, 2, 2, 3, palette.skin)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 10, 1, 2, 5, palette.hair)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, 8, 2, 1, 3, palette.skinDark)
}

function drawVerticalLeg(graphics, originX, originY, pixel, x, step, palette) {
  const y = 8 + step

  spriteRect(graphics, originX, originY, pixel, x - 1, y, 3, 4, palette.outline)
  spriteRect(graphics, originX, originY, pixel, x, y, 1, 3, palette.statusDark)
  spriteRect(graphics, originX, originY, pixel, x - 1, y + 3, 3, 1, palette.shoe)
}

function drawVerticalArm(graphics, originX, originY, pixel, x, step, palette) {
  const y = 5 + step

  spriteRect(graphics, originX, originY, pixel, x, y, 2, 4, palette.outline)
  spriteRect(graphics, originX, originY, pixel, x, y + 1, 1, 2, palette.statusDark)
  spriteRect(graphics, originX, originY, pixel, x, y + 3, 1, 1, palette.skin)
}

function drawHorizontalLeg(graphics, originX, originY, pixel, y, step, mirror, palette) {
  const x = 1 + step

  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x, y - 1, 4, 3, palette.outline)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x + 1, y, 2, 1, palette.statusDark)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x, y - 1, 1, 3, palette.shoe)
}

function drawHorizontalArm(graphics, originX, originY, pixel, y, step, mirror, palette) {
  const x = 5 + step

  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x, y, 4, 2, palette.outline)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x + 1, y, 2, 1, palette.statusDark)
  mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x + 3, y, 1, 1, palette.skin)
}

function walkStride(frame) {
  if (frame === 1) {
    return -1
  }

  if (frame === 3) {
    return 1
  }

  return 0
}

function mirroredSpriteRect(graphics, originX, originY, pixel, mirror, x, y, width, height, fillStyle) {
  const mirroredX = mirror ? 13 - x - width : x

  spriteRect(graphics, originX, originY, pixel, mirroredX, y, width, height, fillStyle)
}

function spriteRect(graphics, originX, originY, pixel, x, y, width, height, fillStyle) {
  graphics
    .rect(
      originX + x * pixel,
      originY + y * pixel,
      Math.max(1, width * pixel),
      Math.max(1, height * pixel)
    )
    .fill(fillStyle)
}

function normalizeColor(color) {
  return Number.isInteger(color) ? color & 0xffffff : 0xe5c748
}

function mixColor(color, target, amount) {
  const clampedAmount = Math.min(Math.max(amount, 0), 1)
  const inverse = 1 - clampedAmount
  const red = Math.round(((color >> 16) & 0xff) * inverse + ((target >> 16) & 0xff) * clampedAmount)
  const green = Math.round(((color >> 8) & 0xff) * inverse + ((target >> 8) & 0xff) * clampedAmount)
  const blue = Math.round((color & 0xff) * inverse + (target & 0xff) * clampedAmount)

  return (red << 16) | (green << 8) | blue
}
