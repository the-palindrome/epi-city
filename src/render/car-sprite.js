import { CAR_CONFIG } from '../core/constants.js'

const CAR_SPRITE_BASE_LENGTH = 25
const LONG_CAR_SPRITE_BASE_LENGTH = 32
const CAR_SPRITE_BASE_WIDTH = 13
const MIN_SPRITE_PIXEL = 1
const OUTLINE_COLOR = 0x17130f
const TIRE_COLOR = 0x111418
const GLASS_COLOR = 0x7fb2c5
const GLASS_LIGHT_COLOR = 0xc2e3ec
const HEADLIGHT_COLOR = 0xffe9a6
const TAILLIGHT_COLOR = 0xdb3b34
const SHADOW_COLOR = 0x000000
const STATIC_CAR_FILL_STYLES = {
  outline: createFillStyle(OUTLINE_COLOR),
  tire: createFillStyle(TIRE_COLOR),
  glass: createFillStyle(GLASS_COLOR),
  glassLight: createFillStyle(GLASS_LIGHT_COLOR, 0.86),
  headlight: createFillStyle(HEADLIGHT_COLOR),
  taillight: createFillStyle(TAILLIGHT_COLOR),
  shadow: createFillStyle(SHADOW_COLOR, 0.32)
}
const CAR_SPRITE_PALETTE_CACHE = new Map()

export function getCarSpriteMetrics(car, city, config = {}) {
  const direction = normalizeDirection(car?.direction)
  const longBody = (car?.lengthTiles || 0) >= 3
  const length = positiveNumberOrDefault(
    longBody ? config.longBodyLength : config.roadBodyLength,
    longBody ? CAR_CONFIG.longBodyLength : CAR_CONFIG.roadBodyLength
  )
  const width = positiveNumberOrDefault(config.bodyWidth, CAR_CONFIG.bodyWidth)

  return {
    length,
    width,
    longBody,
    horizontal: Math.abs(direction.dx) >= Math.abs(direction.dy),
    direction
  }
}

export function drawCarSprite(graphics, car, city, config = {}) {
  if (!graphics || !car?.position) {
    return
  }

  const metrics = getCarSpriteMetrics(car, city, config)
  const baseLength = metrics.longBody ? LONG_CAR_SPRITE_BASE_LENGTH : CAR_SPRITE_BASE_LENGTH
  const pixel = Math.max(
    MIN_SPRITE_PIXEL,
    Math.min(metrics.length / baseLength, metrics.width / CAR_SPRITE_BASE_WIDTH)
  )
  const palette = getCarSpritePalette(car.color)

  if (metrics.horizontal) {
    drawCarTemplate(
      graphics,
      Math.round(car.position.x - (baseLength * pixel) / 2),
      Math.round(car.position.y - (CAR_SPRITE_BASE_WIDTH * pixel) / 2),
      pixel,
      'horizontal',
      baseLength,
      metrics.direction.dx < 0,
      palette,
      metrics.longBody
    )
    return
  }

  drawCarTemplate(
    graphics,
    Math.round(car.position.x - (CAR_SPRITE_BASE_WIDTH * pixel) / 2),
    Math.round(car.position.y - (baseLength * pixel) / 2),
    pixel,
    'vertical',
    baseLength,
    metrics.direction.dy < 0,
    palette,
    metrics.longBody
  )
}

function normalizeDirection(direction) {
  if (!direction ||
      !Number.isFinite(direction.dx) ||
      !Number.isFinite(direction.dy) ||
      (Math.abs(direction.dx) < 0.001 && Math.abs(direction.dy) < 0.001)) {
    return { dx: 1, dy: 0 }
  }

  return direction
}

function getCarSpritePalette(color) {
  const body = normalizeColor(color)
  const cachedPalette = CAR_SPRITE_PALETTE_CACHE.get(body)

  if (cachedPalette) {
    return cachedPalette
  }

  const palette = createCarSpritePalette(body)

  CAR_SPRITE_PALETTE_CACHE.set(body, palette)
  return palette
}

function createCarSpritePalette(body) {
  const bodyDark = mixColor(body, OUTLINE_COLOR, 0.34)
  const bodyDarker = mixColor(body, OUTLINE_COLOR, 0.48)
  const bodyLight = mixColor(body, 0xffffff, 0.38)
  const rim = mixColor(body, 0xffffff, 0.72)

  return {
    body: createFillStyle(body),
    bodyDark: createFillStyle(bodyDark),
    bodyDarker: createFillStyle(bodyDarker),
    bodyLight: createFillStyle(bodyLight),
    rimStrong: createFillStyle(rim, 0.38),
    rimSoft: createFillStyle(rim, 0.24),
    ...STATIC_CAR_FILL_STYLES
  }
}

function createFillStyle(color, alpha = 1) {
  return { color, alpha }
}

function drawCarTemplate(graphics, originX, originY, pixel, orientation, baseLength, mirror, palette, longBody) {
  const rect = (x, y, width, height, fillStyle) => {
    orientedSpriteRect(graphics, originX, originY, pixel, orientation, baseLength, mirror, x, y, width, height, fillStyle)
  }
  const cabinWidth = longBody ? 10 : 8
  const cabinX = Math.floor((baseLength - cabinWidth) / 2)

  rect(2, 10, baseLength - 4, 3, palette.shadow)

  rect(5, 0, 4, 3, palette.tire)
  rect(baseLength - 9, 0, 4, 3, palette.tire)
  rect(5, 10, 4, 3, palette.tire)
  rect(baseLength - 9, 10, 4, 3, palette.tire)

  rect(3, 1, baseLength - 6, 11, palette.rimStrong)
  rect(1, 4, baseLength - 2, 5, palette.rimSoft)

  rect(4, 1, baseLength - 8, 11, palette.outline)
  rect(2, 3, baseLength - 4, 7, palette.outline)
  rect(baseLength - 3, 4, 2, 5, palette.outline)
  rect(1, 5, 2, 3, palette.outline)

  rect(5, 2, baseLength - 10, 9, palette.body)
  rect(3, 4, baseLength - 6, 5, palette.body)
  rect(6, 3, baseLength - 12, 1, palette.bodyLight)
  rect(5, 8, baseLength - 10, 2, palette.bodyDark)
  rect(baseLength - 8, 4, 4, 5, palette.bodyLight)
  rect(4, 5, 4, 3, palette.bodyDarker)

  rect(cabinX - 1, 3, cabinWidth + 2, 7, palette.outline)
  rect(cabinX, 4, cabinWidth, 5, palette.glass)
  rect(cabinX + 1, 4, cabinWidth - 2, 1, palette.glassLight)
  rect(cabinX, 8, cabinWidth, 1, palette.bodyDarker)
  rect(cabinX + cabinWidth - 3, 4, 3, 5, palette.glassLight)

  if (longBody) {
    rect(8, 2, 2, 8, palette.bodyDark)
    rect(baseLength - 10, 2, 2, 8, palette.bodyDark)
  }

  rect(baseLength - 1, 5, 1, 1, palette.headlight)
  rect(baseLength - 1, 7, 1, 1, palette.headlight)
  rect(0, 5, 1, 1, palette.taillight)
  rect(0, 7, 1, 1, palette.taillight)
}

function orientedSpriteRect(graphics, originX, originY, pixel, orientation, baseLength, mirror, x, y, width, height, fillStyle) {
  const forwardX = mirror ? baseLength - x - width : x

  if (orientation === 'vertical') {
    spriteRect(graphics, originX, originY, pixel, y, forwardX, height, width, fillStyle)
    return
  }

  spriteRect(graphics, originX, originY, pixel, forwardX, y, width, height, fillStyle)
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

function positiveNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeColor(color) {
  return Number.isInteger(color) ? color & 0xffffff : 0x3f6fd8
}

function mixColor(color, target, amount) {
  const clampedAmount = Math.min(Math.max(amount, 0), 1)
  const inverse = 1 - clampedAmount
  const red = Math.round(((color >> 16) & 0xff) * inverse + ((target >> 16) & 0xff) * clampedAmount)
  const green = Math.round(((color >> 8) & 0xff) * inverse + ((target >> 8) & 0xff) * clampedAmount)
  const blue = Math.round((color & 0xff) * inverse + (target & 0xff) * clampedAmount)

  return (red << 16) | (green << 8) | blue
}
