import { describe, expect, it } from 'vitest'
import { CAR_CONFIG, NPC_CONFIG } from '../core/constants.js'
import { drawCarSprite, getCarSpriteMetrics } from './car-sprite.js'

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

function spriteBounds(fills) {
  return fills.reduce((box, fill) => ({
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
}

function boundsSize(bounds) {
  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  }
}

const city = {
  tileSize: 32
}

describe('car sprite rendering', () => {
  it('uses NPC-proportional body metrics consistently for parked and driving cars', () => {
    const parked = getCarSpriteMetrics({
      state: 'parked',
      lengthTiles: 2,
      direction: { dx: 1, dy: 0 }
    }, city)
    const driving = getCarSpriteMetrics({
      state: 'driving',
      lengthTiles: 2,
      direction: { dx: 1, dy: 0 }
    }, city)
    const longCar = getCarSpriteMetrics({
      state: 'parked',
      lengthTiles: 3,
      direction: { dx: 1, dy: 0 }
    }, city)

    expect(parked.length).toBe(CAR_CONFIG.roadBodyLength)
    expect(parked.width).toBe(CAR_CONFIG.bodyWidth)
    expect(parked).toEqual(driving)
    expect(parked.width).toBeGreaterThan(NPC_CONFIG.size)
    expect(parked.length).toBeLessThan(city.tileSize * 2 * 0.82)
    expect(longCar.length).toBe(CAR_CONFIG.longBodyLength)
    expect(longCar.length).toBeLessThan(city.tileSize * 3 * 0.82)
  })

  it('draws a multi-part pixel-art car sprite with body color, outline, and shadow', () => {
    const graphics = createGraphics()
    const car = {
      id: 1,
      color: 0x3f6fd8,
      lengthTiles: 2,
      direction: { dx: 1, dy: 0 },
      position: { x: 96, y: 64 }
    }

    drawCarSprite(graphics, car, city)

    expect(graphics.fills.length).toBeGreaterThan(24)
    expect(graphics.fills.some((fill) => fill.color === car.color)).toBe(true)
    expect(graphics.fills.some((fill) => fill.color === 0x17130f)).toBe(true)
    expect(graphics.fills.some((fill) => fill.alpha < 1)).toBe(true)
  })

  it('swaps visual bounds for horizontal and vertical facings', () => {
    const horizontalGraphics = createGraphics()
    const verticalGraphics = createGraphics()
    const baseCar = {
      id: 2,
      color: 0xd94a48,
      lengthTiles: 2,
      position: { x: 128, y: 128 }
    }

    drawCarSprite(horizontalGraphics, { ...baseCar, direction: { dx: 1, dy: 0 } }, city)
    drawCarSprite(verticalGraphics, { ...baseCar, direction: { dx: 0, dy: 1 } }, city)

    const horizontal = boundsSize(spriteBounds(horizontalGraphics.fills))
    const vertical = boundsSize(spriteBounds(verticalGraphics.fills))

    expect(horizontal.width).toBeGreaterThan(horizontal.height)
    expect(vertical.height).toBeGreaterThan(vertical.width)
    expect(Math.round(horizontal.width)).toBe(Math.round(vertical.height))
    expect(Math.round(horizontal.height)).toBe(Math.round(vertical.width))
  })

  it('draws three-tile vehicles longer without using the whole gameplay footprint', () => {
    const shortGraphics = createGraphics()
    const longGraphics = createGraphics()

    drawCarSprite(shortGraphics, {
      id: 3,
      color: 0x55b86b,
      lengthTiles: 2,
      direction: { dx: 1, dy: 0 },
      position: { x: 128, y: 96 }
    }, city)
    drawCarSprite(longGraphics, {
      id: 4,
      color: 0x55b86b,
      lengthTiles: 3,
      direction: { dx: 1, dy: 0 },
      position: { x: 128, y: 96 }
    }, city)

    const short = boundsSize(spriteBounds(shortGraphics.fills))
    const long = boundsSize(spriteBounds(longGraphics.fills))

    expect(long.width).toBeGreaterThan(short.width + 8)
    expect(short.width).toBeLessThan(city.tileSize * 2 * 0.82)
    expect(long.width).toBeLessThan(city.tileSize * 3 * 0.82)
  })
})
