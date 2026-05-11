import {
  CAR_CONFIG,
  ENTITY_RENDER_DEBUG_CONFIG,
  ENTITY_RENDER_MODE_ID,
  ENTITY_RENDER_MODES,
  INFECTION_CONFIG
} from '../core/constants.js'
import { createCanvas, createCanvasGraphics } from './canvas-graphics.js'
import { drawEntityTrails } from './entity-trails.js'
import { applyNearestSampling } from './texture-sampling.js'

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
const CAR_SPRITE_TEXTURE_CACHE = new Map()

export function getCarSpriteMetrics(car, city, config = {}) {
  const direction = normalizeDirection(car?.direction)
  const longBody = (car?.lengthTiles || 0) >= 3
  const length = positiveNumberOrDefault(
    longBody ? config.longBodyLength : config.roadBodyLength,
    longBody ? CAR_CONFIG.longBodyLength : CAR_CONFIG.roadBodyLength
  )
  const width = positiveNumberOrDefault(config.bodyWidth, CAR_CONFIG.bodyWidth)
  const baseLength = longBody ? LONG_CAR_SPRITE_BASE_LENGTH : CAR_SPRITE_BASE_LENGTH
  const pixel = Math.max(
    MIN_SPRITE_PIXEL,
    Math.min(length / baseLength, width / CAR_SPRITE_BASE_WIDTH)
  )
  const horizontal = Math.abs(direction.dx) >= Math.abs(direction.dy)

  return {
    length,
    width,
    longBody,
    baseLength,
    baseWidth: CAR_SPRITE_BASE_WIDTH,
    pixel,
    textureWidth: Math.round((horizontal ? baseLength : CAR_SPRITE_BASE_WIDTH) * pixel),
    textureHeight: Math.round((horizontal ? CAR_SPRITE_BASE_WIDTH : baseLength) * pixel),
    horizontal,
    direction
  }
}

export function createCarSpriteRenderer(cars, city, config = {}, options = {}) {
  const pixi = options.pixi
  const Container = getPixiMember(pixi, 'Container')
  const Sprite = getPixiMember(pixi, 'Sprite')

  if (typeof Container !== 'function' || typeof Sprite !== 'function') {
    return createGraphicsCarSpriteRenderer(cars, city, config, pixi)
  }

  const spriteRenderer = createSpriteCarSpriteRenderer(cars, city, config, options)

  return createModeAwareCarRenderer(spriteRenderer, cars, city, config, options)
}

function createSpriteCarSpriteRenderer(cars, city, config = {}, options = {}) {
  const pixi = options.pixi

  const textureFactory = options.textureFactory || createAtlasCarSpriteTextureFactory(cars, city, config, pixi)
  const container = new pixi.Container()
  const sprites = []
  const lastColors = []
  const lastLengthTiles = []
  const lastDirectionIds = []

  container.eventMode = 'none'
  container.zIndex = config.zorder
  container.zorder = config.zorder
  container.sortableChildren = false

  function ensureSprite(index) {
    if (sprites[index]) {
      return sprites[index]
    }

    const sprite = new pixi.Sprite()

    sprite.eventMode = 'none'
    sprite.roundPixels = true
    sprite.visible = false
    sprite.zIndex = config.zorder
    sprite.zorder = config.zorder

    if (sprite.anchor && typeof sprite.anchor.set === 'function') {
      sprite.anchor.set(0.5)
    } else {
      sprite.anchor = { x: 0.5, y: 0.5 }
    }

    sprites[index] = sprite
    container.addChild(sprite)
    return sprite
  }

  function render(nextCars = cars) {
    for (let index = 0; index < nextCars.length; index += 1) {
      const car = nextCars[index]
      const sprite = ensureSprite(index)

      if (!car?.position) {
        sprite.visible = false
        continue
      }

      const directionId = carSpriteDirectionId(car.direction)

      if (lastColors[index] !== car.color ||
          lastLengthTiles[index] !== car.lengthTiles ||
          lastDirectionIds[index] !== directionId) {
        const textureKey = getCarSpriteTextureKey(car, city, config)

        sprite.texture = textureFactory(textureKey, car, city, config, pixi)
        lastColors[index] = car.color
        lastLengthTiles[index] = car.lengthTiles
        lastDirectionIds[index] = directionId
      }

      sprite.visible = true
      sprite.x = Math.round(car.position.x)
      sprite.y = Math.round(car.position.y)
    }

    for (let index = nextCars.length; index < sprites.length; index += 1) {
      sprites[index].visible = false
    }
  }

  function destroy() {
    for (const sprite of sprites) {
      if (sprite && typeof sprite.destroy === 'function') {
        sprite.destroy()
      }
    }

    sprites.length = 0
    lastColors.length = 0
    lastLengthTiles.length = 0
    lastDirectionIds.length = 0

    if (container.parent) {
      container.parent.removeChild(container)
    }

    if (typeof container.destroy === 'function') {
      container.destroy({ children: true })
    }
  }

  return {
    display: container,
    sprites,
    render,
    destroy
  }
}

function createModeAwareCarRenderer(spriteRenderer, cars, city, config, options) {
  const pixi = options.pixi
  const Container = getPixiMember(pixi, 'Container')
  const Graphics = getPixiMember(pixi, 'Graphics')

  if (typeof Container !== 'function' || typeof Graphics !== 'function') {
    return spriteRenderer
  }

  const container = new Container()
  const geometricRenderer = createGeometricCarRenderer(cars, city, config, pixi)
  const overlayGraphics = new Graphics()
  const trailHistories = new Map()
  let renderMode = normalizeEntityRenderMode(options.entityRenderMode ?? config.entityRenderMode)
  let debugOptions = normalizeEntityDebugOptions(options.entityDebugOptions ?? config.entityDebugOptions)

  container.eventMode = 'none'
  container.zIndex = config.zorder
  container.zorder = config.zorder
  container.sortableChildren = false
  overlayGraphics.eventMode = 'none'
  overlayGraphics.zIndex = config.zorder
  overlayGraphics.zorder = config.zorder
  container.addChild(spriteRenderer.display)
  container.addChild(geometricRenderer.display)
  container.addChild(overlayGraphics)
  applyCarRenderModeVisibility()

  function applyCarRenderModeVisibility() {
    spriteRenderer.display.visible = renderMode === 'sprite'
    geometricRenderer.display.visible = renderMode === 'geometric'
  }

  function render(nextCars = cars) {
    if (renderMode === 'geometric') {
      geometricRenderer.render(nextCars)
    } else {
      spriteRenderer.render(nextCars)
    }

    drawCarDebugOverlays(overlayGraphics, nextCars, debugOptions, trailHistories)
  }

  function setRenderMode(mode) {
    renderMode = normalizeEntityRenderMode(mode)
    applyCarRenderModeVisibility()
  }

  function setDebugOptions(options) {
    debugOptions = normalizeEntityDebugOptions({
      ...debugOptions,
      ...options
    })

    if (!debugOptions.pathTrailsVisible) {
      trailHistories.clear()
    }
  }

  function destroy() {
    spriteRenderer.destroy()
    geometricRenderer.destroy()
    overlayGraphics.destroy()

    if (container.parent) {
      container.parent.removeChild(container)
    }

    if (typeof container.destroy === 'function') {
      container.destroy({ children: true })
    }
  }

  return {
    display: container,
    spriteDisplay: spriteRenderer.display,
    sprites: spriteRenderer.sprites || [],
    render,
    setRenderMode,
    setDebugOptions,
    get renderMode() {
      return renderMode
    },
    destroy
  }
}

export function drawCarSprite(graphics, car, city, config = {}) {
  if (!graphics || !car?.position) {
    return
  }

  const metrics = getCarSpriteMetrics(car, city, config)
  const palette = getCarSpritePalette(car.color)

  if (metrics.horizontal) {
    drawCarTemplate(
      graphics,
      Math.round(car.position.x - (metrics.baseLength * metrics.pixel) / 2),
      Math.round(car.position.y - (metrics.baseWidth * metrics.pixel) / 2),
      metrics.pixel,
      'horizontal',
      metrics.baseLength,
      metrics.direction.dx < 0,
      palette,
      metrics.longBody
    )
    return
  }

  drawCarTemplate(
    graphics,
    Math.round(car.position.x - (metrics.baseWidth * metrics.pixel) / 2),
    Math.round(car.position.y - (metrics.baseLength * metrics.pixel) / 2),
    metrics.pixel,
    'vertical',
    metrics.baseLength,
    metrics.direction.dy < 0,
    palette,
    metrics.longBody
  )
}

function createGeometricCarRenderer(cars, city, config, pixi) {
  const graphics = new pixi.Graphics()

  graphics.eventMode = 'none'
  graphics.zIndex = config.zorder
  graphics.zorder = config.zorder

  return {
    display: graphics,
    render(nextCars = cars) {
      graphics.clear()

      for (const car of nextCars) {
        drawGeometricCar(graphics, car, city, config)
      }
    },
    destroy() {
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

function drawGeometricCar(graphics, car, city, config = {}) {
  if (!graphics || !car?.position) {
    return
  }

  const metrics = getCarSpriteMetrics(car, city, config)
  const color = getCarPassengerInfectionColor(car, config.infectionColors)
  const width = metrics.horizontal ? metrics.length : metrics.width
  const height = metrics.horizontal ? metrics.width : metrics.length

  graphics
    .rect(
      Math.round(car.position.x - width / 2),
      Math.round(car.position.y - height / 2),
      Math.round(width),
      Math.round(height)
    )
    .fill({ color, alpha: 1 })
}

export function getCarPassengerInfectionColor(car, infectionColors = INFECTION_CONFIG.colors) {
  const infection = getHighestPriorityPassengerInfection(car)
  const colors = normalizeInfectionColors(infectionColors)

  return infection ? colors[infection] : normalizeColor(car?.color)
}

function drawCarDebugOverlays(graphics, cars, debugOptions, trailHistories) {
  graphics.clear()

  if (!debugOptions.pathTrailsVisible) {
    return
  }

  drawEntityTrails(graphics, cars || [], trailHistories, debugOptions.pathTrailLength, (car) => (
    getCarPassengerInfectionColor(car, debugOptions.infectionColors)
  ), 0.5)
}

function getCarSpriteTextureKey(car, city, config = {}) {
  const metrics = getCarSpriteMetrics(car, city, config)
  const color = normalizeColor(car?.color).toString(16).padStart(6, '0')
  const direction = metrics.horizontal
    ? (metrics.direction.dx < 0 ? 'west' : 'east')
    : (metrics.direction.dy < 0 ? 'north' : 'south')

  return [
    color,
    metrics.longBody ? 'long' : 'short',
    direction,
    metrics.textureWidth,
    metrics.textureHeight
  ].join(':')
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

function carSpriteDirectionId(direction) {
  if (!direction ||
      !Number.isFinite(direction.dx) ||
      !Number.isFinite(direction.dy) ||
      (Math.abs(direction.dx) < 0.001 && Math.abs(direction.dy) < 0.001)) {
    return 0
  }

  if (Math.abs(direction.dx) >= Math.abs(direction.dy)) {
    return direction.dx < 0 ? 1 : 0
  }

  return direction.dy < 0 ? 3 : 2
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

function defaultCarSpriteTextureFactory(textureKey, car, city, config, pixi) {
  const cachedTexture = CAR_SPRITE_TEXTURE_CACHE.get(textureKey)

  if (cachedTexture) {
    return cachedTexture
  }

  const texture = createCarSpriteTexture(car, city, config, pixi)

  CAR_SPRITE_TEXTURE_CACHE.set(textureKey, texture)
  return texture
}

function createAtlasCarSpriteTextureFactory(cars, city, config, pixi) {
  const atlas = createCarSpriteAtlas(cars, city, config, pixi)

  if (!atlas) {
    return defaultCarSpriteTextureFactory
  }

  return (textureKey, car, nextCity, nextConfig, nextPixi) => {
    return atlas.textures.get(textureKey) ||
      defaultCarSpriteTextureFactory(textureKey, car, nextCity, nextConfig, nextPixi)
  }
}

function createCarSpriteAtlas(cars, city, config, pixi) {
  if (!pixi.Texture ||
      typeof pixi.Texture.from !== 'function' ||
      typeof pixi.Texture !== 'function' ||
      typeof pixi.Rectangle !== 'function') {
    return null
  }

  const specs = createCarSpriteAtlasSpecs(cars, city, config)

  if (specs.length === 0) {
    return null
  }

  const padding = 1
  const atlasWidth = 512
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const spec of specs) {
    if (cursorX > 0 && cursorX + spec.width > atlasWidth) {
      cursorX = 0
      cursorY += rowHeight + padding
      rowHeight = 0
    }

    spec.x = cursorX
    spec.y = cursorY
    cursorX += spec.width + padding
    rowHeight = Math.max(rowHeight, spec.height)
  }

  const atlasHeight = cursorY + rowHeight
  const canvas = createCanvas(atlasWidth, atlasHeight)

  if (!canvas) {
    return null
  }

  const context = canvas.getContext?.('2d')

  if (!context) {
    return null
  }

  context.imageSmoothingEnabled = false

  for (const spec of specs) {
    drawCarTemplate(
      createCanvasGraphics(context),
      spec.x,
      spec.y,
      spec.metrics.pixel,
      spec.metrics.horizontal ? 'horizontal' : 'vertical',
      spec.metrics.baseLength,
      spec.metrics.horizontal ? spec.metrics.direction.dx < 0 : spec.metrics.direction.dy < 0,
      spec.palette,
      spec.metrics.longBody
    )
  }

  const atlasTexture = pixi.Texture.from(canvas, true)
  const textures = new Map()

  applyNearestSampling(atlasTexture)

  for (const spec of specs) {
    const texture = new pixi.Texture({
      source: atlasTexture.source,
      frame: new pixi.Rectangle(spec.x, spec.y, spec.width, spec.height)
    })

    applyNearestSampling(texture)
    textures.set(spec.key, texture)
  }

  return { atlasTexture, textures }
}

function createCarSpriteAtlasSpecs(cars, city, config) {
  const colors = new Set()
  const specs = []
  const seenKeys = new Set()

  for (const color of config.colorPalette || []) {
    colors.add(normalizeColor(color))
  }

  for (const car of cars || []) {
    colors.add(normalizeColor(car?.color))
  }

  for (const color of colors) {
    for (const lengthTiles of [2, 3]) {
      for (const direction of [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ]) {
        const car = {
          color,
          lengthTiles,
          direction,
          position: { x: 0, y: 0 }
        }
        const key = getCarSpriteTextureKey(car, city, config)

        if (seenKeys.has(key)) {
          continue
        }

        const metrics = getCarSpriteMetrics(car, city, config)

        seenKeys.add(key)
        specs.push({
          key,
          car,
          metrics,
          palette: getCarSpritePalette(color),
          width: metrics.textureWidth,
          height: metrics.textureHeight,
          x: 0,
          y: 0
        })
      }
    }
  }

  return specs
}

function createCarSpriteTexture(car, city, config, pixi) {
  const metrics = getCarSpriteMetrics(car, city, config)
  const palette = getCarSpritePalette(car.color)
  const canvas = createCanvas(metrics.textureWidth, metrics.textureHeight)

  if (!canvas || !pixi.Texture || typeof pixi.Texture.from !== 'function') {
    return pixi.Texture?.EMPTY || null
  }

  const context = canvas.getContext?.('2d')

  if (!context) {
    return pixi.Texture?.EMPTY || null
  }

  context.imageSmoothingEnabled = false
  drawCarTemplate(
    createCanvasGraphics(context),
    0,
    0,
    metrics.pixel,
    metrics.horizontal ? 'horizontal' : 'vertical',
    metrics.baseLength,
    metrics.horizontal ? metrics.direction.dx < 0 : metrics.direction.dy < 0,
    palette,
    metrics.longBody
  )

  const texture = pixi.Texture.from(canvas, true)

  applyNearestSampling(texture)
  return texture
}

function createGraphicsCarSpriteRenderer(cars, city, config, pixi) {
  const graphics = new pixi.Graphics()

  graphics.eventMode = 'none'
  graphics.zIndex = config.zorder
  graphics.zorder = config.zorder

  return {
    display: graphics,
    sprites: [],
    render(nextCars = cars) {
      graphics.clear()

      for (const car of nextCars) {
        drawCarSprite(graphics, car, city, config)
      }
    },
    destroy() {
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
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

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function normalizeColor(color) {
  return Number.isInteger(color) ? color & 0xffffff : 0x3f6fd8
}

function getPixiMember(pixi, key) {
  if (!pixi || !Object.prototype.hasOwnProperty.call(pixi, key)) {
    return null
  }

  return pixi[key]
}

function normalizeInfectionColors(colors = {}) {
  const palette = colors || {}
  const fallback = INFECTION_CONFIG.colors

  return {
    susceptible: normalizeColor(palette.susceptible ?? fallback.susceptible),
    exposed: normalizeColor(palette.exposed ?? fallback.exposed),
    infectious: normalizeColor(palette.infectious ?? fallback.infectious),
    recovered: normalizeColor(palette.recovered ?? fallback.recovered)
  }
}

function getHighestPriorityPassengerInfection(car) {
  const infections = new Set()

  for (const owner of car?.riderOwners || []) {
    const infection = owner?.npc?.infection

    if (Object.prototype.hasOwnProperty.call(INFECTION_CONFIG.colors, infection)) {
      infections.add(infection)
    }
  }

  for (const infection of ['infectious', 'exposed', 'recovered', 'susceptible']) {
    if (infections.has(infection)) {
      return infection
    }
  }

  return null
}

function normalizeEntityRenderMode(mode) {
  const id = String(mode || '')

  return Object.prototype.hasOwnProperty.call(ENTITY_RENDER_MODES, id)
    ? id
    : ENTITY_RENDER_MODE_ID
}

function normalizeEntityDebugOptions(options = {}) {
  const debugOptions = options || {}

  return {
    pathTrailsVisible: Boolean(debugOptions.pathTrailsVisible),
    pathTrailLength: positiveIntegerOrDefault(
      debugOptions.pathTrailLength,
      ENTITY_RENDER_DEBUG_CONFIG.pathTrailLength
    ),
    infectionColors: debugOptions.infectionColors || INFECTION_CONFIG.colors
  }
}

function mixColor(color, target, amount) {
  const clampedAmount = Math.min(Math.max(amount, 0), 1)
  const inverse = 1 - clampedAmount
  const red = Math.round(((color >> 16) & 0xff) * inverse + ((target >> 16) & 0xff) * clampedAmount)
  const green = Math.round(((color >> 8) & 0xff) * inverse + ((target >> 8) & 0xff) * clampedAmount)
  const blue = Math.round((color & 0xff) * inverse + (target & 0xff) * clampedAmount)

  return (red << 16) | (green << 8) | blue
}
