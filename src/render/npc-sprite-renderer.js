import {
  ENTITY_RENDER_DEBUG_CONFIG,
  ENTITY_RENDER_MODE_ID,
  ENTITY_RENDER_MODES,
  INFECTION_CONFIG,
  NPC_CONFIG
} from '../core/constants.js'
import {
  NPC_SPRITE_FRAME_COUNT,
  NPC_SPRITE_FRAME_DISTANCE,
  createNpcSpriteState,
  drawNpcSprite,
  getNpcSpriteFrame,
  getNpcSpriteMetrics
} from './npc-sprite.js'
import { createCanvas, createCanvasGraphics } from './canvas-graphics.js'
import { drawEntityTrails, finitePosition, strokePolyline } from './entity-trails.js'
import { applyNearestSampling } from './texture-sampling.js'

const NPC_SPRITE_FACINGS = Object.freeze(['south', 'east', 'north', 'west'])
const NPC_SPRITE_FACING_IDS = Object.freeze({
  south: 0,
  east: 1,
  north: 2,
  west: 3
})
const NPC_TEXTURES_PER_FACING = NPC_SPRITE_FRAME_COUNT
const NPC_TEXTURES_PER_COLOR = NPC_SPRITE_FACINGS.length * NPC_TEXTURES_PER_FACING
const DEBUG_EDGE_WIDTH = 3

export function createNpcSpriteRenderer(npcs, city, config = {}, infection = null, options = {}) {
  const pixi = options.pixi
  const textureAtlas = options.textureAtlas || createNpcSpriteAtlas(npcs, config, infection, pixi)
  let spriteRenderer = null

  if (textureAtlas && pixi &&
      typeof pixi.ParticleContainer === 'function' &&
      typeof pixi.Particle === 'function') {
    spriteRenderer = createParticleNpcSpriteRenderer(npcs, city, config, infection, {
      ...options,
      pixi,
      textureAtlas
    })
  } else if (textureAtlas && pixi &&
      typeof pixi.Container === 'function' &&
      typeof pixi.Sprite === 'function') {
    spriteRenderer = createSpriteNpcSpriteRenderer(npcs, city, config, infection, {
      ...options,
      pixi,
      textureAtlas
    })
  } else {
    spriteRenderer = createGraphicsNpcSpriteRenderer(npcs, city, config, infection, options)
  }

  return createModeAwareNpcRenderer(spriteRenderer, npcs, city, config, infection, options)
}

function createModeAwareNpcRenderer(spriteRenderer, npcs, city, config, infection, options) {
  const pixi = options.pixi
  const Container = getPixiMember(pixi, 'Container')
  const Graphics = getPixiMember(pixi, 'Graphics')

  if (typeof Container !== 'function' || typeof Graphics !== 'function') {
    return spriteRenderer
  }

  const container = new Container()
  const geometricRenderer = createGeometricNpcRenderer(npcs, city, config, infection, options)
  const overlayGraphics = new Graphics()
  const trailHistories = new Map()
  const getTransmissionEvents = typeof options.getTransmissionEvents === 'function'
    ? options.getTransmissionEvents
    : () => []
  const getContactEvents = typeof options.getContactEvents === 'function'
    ? options.getContactEvents
    : () => []
  const clock = options.clock || null
  let renderMode = normalizeEntityRenderMode(options.entityRenderMode ?? config.entityRenderMode)
  let debugOptions = normalizeEntityDebugOptions(options.entityDebugOptions ?? config.entityDebugOptions)

  configureDisplay(container, config)
  configureDisplay(overlayGraphics, {
    ...config,
    zorder: ENTITY_RENDER_DEBUG_CONFIG.zorder
  })
  container.sortableChildren = false
  container.addChild(spriteRenderer.display)
  container.addChild(geometricRenderer.display)
  applyNpcRenderModeVisibility()

  function applyNpcRenderModeVisibility() {
    spriteRenderer.display.visible = renderMode === 'sprite'
    geometricRenderer.display.visible = renderMode === 'geometric'
  }

  function render(nextNpcs = npcs, nextInfection = infection) {
    if (renderMode === 'geometric') {
      geometricRenderer.render(nextNpcs, nextInfection)
    } else {
      spriteRenderer.render(nextNpcs, nextInfection)
    }

    drawNpcDebugOverlays(overlayGraphics, nextNpcs, nextInfection, {
      city,
      clock,
      config,
      debugOptions,
      getContactEvents,
      getTransmissionEvents,
      trailHistories
    })
  }

  function setRenderMode(mode) {
    renderMode = normalizeEntityRenderMode(mode)
    applyNpcRenderModeVisibility()
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
    if (overlayGraphics.parent) {
      overlayGraphics.parent.removeChild(overlayGraphics)
    }
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
    debugDisplay: overlayGraphics,
    sprites: spriteRenderer.sprites || [],
    particles: spriteRenderer.particles || [],
    textureAtlas: spriteRenderer.textureAtlas,
    render,
    setRenderMode,
    setDebugOptions,
    get renderMode() {
      return renderMode
    },
    destroy
  }
}

function createParticleNpcSpriteRenderer(npcs, city, config, infection, options) {
  const { pixi, textureAtlas } = options
  const visibleTileCounts = options.visibleTileCounts || new Uint8Array(city.tiles.length)
  const visibleTileIndexes = options.visibleTileIndexes || []
  const particles = []
  const textureSlots = []
  const container = new pixi.ParticleContainer({
    texture: textureAtlas.atlasTexture,
    dynamicProperties: {
      position: true,
      uvs: true,
      vertex: false,
      rotation: false,
      color: false
    },
    roundPixels: true
  })

  configureDisplay(container, config)
  container.sortableChildren = false

  function ensureParticle(index) {
    if (particles[index]) {
      return particles[index]
    }

    const particle = new pixi.Particle({
      texture: textureAtlas.defaultTexture,
      anchorX: 0.5,
      anchorY: 0.5,
      x: -100000,
      y: -100000,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      tint: 0xffffff,
      alpha: 1
    })

    particles[index] = particle
    textureSlots[index] = -1
    return particle
  }

  function render(nextNpcs = npcs, nextInfection = infection) {
    const visibleLimit = getVisibleNpcLimit(config)
    const activeParticles = container.particleChildren
    let visibleCount = 0
    let childrenChanged = false

    for (let index = 0; index < nextNpcs.length; index += 1) {
      const npc = nextNpcs[index]

      if (!npc?.present || !npc.position) {
        continue
      }

      if (!reserveVisibleNpcTile(tileIndexAtPosition(city, npc.position), visibleLimit, visibleTileCounts, visibleTileIndexes)) {
        continue
      }

      const particle = ensureParticle(visibleCount)
      const color = getNpcRenderColor(nextInfection, npc)
      const slot = getNpcTextureSlot(textureAtlas, npc, color)
      const texture = textureAtlas.textures[slot] || textureAtlas.defaultTexture

      if (textureSlots[visibleCount] !== slot) {
        particle.texture = texture
        textureSlots[visibleCount] = slot
      }

      const x = Math.round(npc.position.x)
      const y = Math.round(npc.position.y)

      if (particle.x !== x) {
        particle.x = x
      }

      if (particle.y !== y) {
        particle.y = y
      }

      if (activeParticles[visibleCount] !== particle) {
        activeParticles[visibleCount] = particle
        childrenChanged = true
      }

      visibleCount += 1
    }

    if (activeParticles.length !== visibleCount) {
      activeParticles.length = visibleCount
      childrenChanged = true
    }

    clearVisibleNpcTiles(visibleTileCounts, visibleTileIndexes)

    if (childrenChanged && typeof container.update === 'function') {
      container.update()
    }
  }

  function destroy() {
    particles.length = 0
    textureSlots.length = 0
    container.particleChildren.length = 0

    if (container.parent) {
      container.parent.removeChild(container)
    }

    if (typeof container.destroy === 'function') {
      container.destroy()
    }
  }

  return {
    display: container,
    particles,
    textureAtlas,
    render,
    destroy
  }
}

function createSpriteNpcSpriteRenderer(npcs, city, config, infection, options) {
  const { pixi, textureAtlas } = options
  const visibleTileCounts = options.visibleTileCounts || new Uint8Array(city.tiles.length)
  const visibleTileIndexes = options.visibleTileIndexes || []
  const container = new pixi.Container()
  const sprites = []
  const textureSlots = []

  configureDisplay(container, config)
  container.sortableChildren = false

  function ensureSprite(index) {
    if (sprites[index]) {
      return sprites[index]
    }

    const sprite = new pixi.Sprite(textureAtlas.defaultTexture)

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
    textureSlots[index] = -1
    container.addChild(sprite)
    return sprite
  }

  function render(nextNpcs = npcs, nextInfection = infection) {
    const visibleLimit = getVisibleNpcLimit(config)
    let visibleCount = 0

    for (let index = 0; index < nextNpcs.length; index += 1) {
      const npc = nextNpcs[index]

      if (!npc?.present || !npc.position) {
        continue
      }

      if (!reserveVisibleNpcTile(tileIndexAtPosition(city, npc.position), visibleLimit, visibleTileCounts, visibleTileIndexes)) {
        continue
      }

      const sprite = ensureSprite(visibleCount)
      const color = getNpcRenderColor(nextInfection, npc)
      const slot = getNpcTextureSlot(textureAtlas, npc, color)

      if (textureSlots[visibleCount] !== slot) {
        sprite.texture = textureAtlas.textures[slot] || textureAtlas.defaultTexture
        textureSlots[visibleCount] = slot
      }

      const x = Math.round(npc.position.x)
      const y = Math.round(npc.position.y)

      if (!sprite.visible) {
        sprite.visible = true
      }

      if (sprite.x !== x) {
        sprite.x = x
      }

      if (sprite.y !== y) {
        sprite.y = y
      }

      visibleCount += 1
    }

    for (let index = visibleCount; index < sprites.length; index += 1) {
      sprites[index].visible = false
    }

    clearVisibleNpcTiles(visibleTileCounts, visibleTileIndexes)
  }

  function destroy() {
    for (const sprite of sprites) {
      if (sprite && typeof sprite.destroy === 'function') {
        sprite.destroy()
      }
    }

    sprites.length = 0
    textureSlots.length = 0

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
    textureAtlas,
    render,
    destroy
  }
}

function createGraphicsNpcSpriteRenderer(npcs, city, config, infection, options) {
  const pixi = options.pixi
  const graphics = new pixi.Graphics()
  const visibleTileCounts = options.visibleTileCounts || new Uint8Array(city.tiles.length)
  const visibleTileIndexes = options.visibleTileIndexes || []

  configureDisplay(graphics, config)

  return {
    display: graphics,
    sprites: [],
    render(nextNpcs = npcs, nextInfection = infection) {
      graphics.clear()
      const visibleLimit = getVisibleNpcLimit(config)

      for (let index = 0; index < nextNpcs.length; index += 1) {
        const npc = nextNpcs[index]

        if (!npc?.present || !npc.position) {
          continue
        }

        if (!reserveVisibleNpcTile(tileIndexAtPosition(city, npc.position), visibleLimit, visibleTileCounts, visibleTileIndexes)) {
          continue
        }

        drawNpcSprite(graphics, npc, {
          color: getNpcRenderColor(nextInfection, npc),
          size: config.size
        })
      }

      clearVisibleNpcTiles(visibleTileCounts, visibleTileIndexes)
    },
    destroy() {
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

function createGeometricNpcRenderer(npcs, city, config, infection, options) {
  const pixi = options.pixi
  const graphics = new pixi.Graphics()
  const visibleTileCounts = options.visibleTileCounts || new Uint8Array(city.tiles.length)
  const visibleTileIndexes = options.visibleTileIndexes || []

  configureDisplay(graphics, config)

  return {
    display: graphics,
    render(nextNpcs = npcs, nextInfection = infection) {
      graphics.clear()
      const visibleLimit = getVisibleNpcLimit(config)

      for (let index = 0; index < nextNpcs.length; index += 1) {
        const npc = nextNpcs[index]

        if (!npc?.present || !npc.position) {
          continue
        }

        if (!reserveVisibleNpcTile(tileIndexAtPosition(city, npc.position), visibleLimit, visibleTileCounts, visibleTileIndexes)) {
          continue
        }

        drawGeometricNpc(graphics, npc, {
          color: getNpcRenderColor(nextInfection, npc),
          size: config.size
        })
      }

      clearVisibleNpcTiles(visibleTileCounts, visibleTileIndexes)
    },
    destroy() {
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

function drawGeometricNpc(graphics, npc, options = {}) {
  if (!graphics || !npc?.position) {
    return
  }

  const color = normalizeColor(options.color)
  const radius = Math.max(2, positiveNumberOrDefault(options.size, NPC_CONFIG.size) / 2)
  const x = Math.round(npc.position.x)
  const y = Math.round(npc.position.y)

  if (typeof graphics.circle === 'function') {
    graphics.circle(x, y, radius).fill({ color, alpha: 1 })
    return
  }

  graphics
    .rect(x - radius, y - radius, radius * 2, radius * 2)
    .fill({ color, alpha: 1 })
}

function drawNpcDebugOverlays(graphics, npcs, infection, context) {
  graphics.clear()

  const options = context.debugOptions

  if (!options.infectionRadiusVisible && !options.infectionEdgesVisible && !options.contactEdgesVisible && !options.pathTrailsVisible) {
    return
  }

  const visibleNpcs = []
  const infectionRadiusNpcs = []
  const npcById = new Map()

  for (const npc of npcs || []) {
    if (!npc || !finitePosition(npc.position)) {
      continue
    }

    npcById.set(npc.id, npc)

    if (npc.present) {
      visibleNpcs.push(npc)
    }

    if (!npc.vehicleTrip) {
      infectionRadiusNpcs.push(npc)
    }
  }

  if (options.pathTrailsVisible) {
    drawEntityTrails(
      graphics,
      visibleNpcs,
      context.trailHistories,
      options.pathTrailLength,
      (npc) => getNpcRenderColor(infection, npc),
      0.52
    )
  }

  if (options.infectionRadiusVisible) {
    drawInfectionRadiusOverlays(graphics, infectionRadiusNpcs, infection)
  }

  if (options.contactEdgesVisible) {
    drawContactEdges(graphics, npcById, context.getContactEvents, options.contactEdgeDurationSeconds, context.clock)
  }

  if (options.infectionEdgesVisible) {
    drawTransmissionEdges(graphics, npcById, context.getTransmissionEvents, options.infectionEdgeDurationSeconds, context.clock)
  }
}

function drawInfectionRadiusOverlays(graphics, npcs, infection) {
  const radius = Number(infection && infection.infectionDistance)

  if (!Number.isFinite(radius) || radius <= 0 || typeof graphics.circle !== 'function') {
    return
  }

  for (const npc of npcs) {
    if (npc.infection !== 'infectious') {
      continue
    }
    const position = finitePosition(npc.position)

    if (!position) {
      continue
    }

    graphics
      .circle(position.x, position.y, radius)
      .stroke({ width: 2, color: getNpcRenderColor(infection, npc), alpha: 0.44, pixelLine: true })
  }
}

function drawTransmissionEdges(graphics, npcById, getTransmissionEvents, durationSeconds, clock) {
  const events = getTransmissionEvents({ maxAgeSeconds: durationSeconds })
  const now = getElapsedSimulationSeconds(clock)

  for (const event of events) {
    const age = now === null ? 0 : Math.max(0, now - event.simulationSeconds)
    const alpha = now === null ? 0.86 : Math.max(0.18, 1 - age / Math.max(durationSeconds, 1))
    const from = currentOrSnapshotPosition(npcById.get(event.sourceNpcId), event.sourcePosition)
    const to = currentOrSnapshotPosition(npcById.get(event.targetNpcId), event.targetPosition)

    if (!from || !to) {
      continue
    }

    drawDirectedLine(graphics, from, to, {
      color: INFECTION_CONFIG.colors.infectious,
      alpha,
      width: DEBUG_EDGE_WIDTH
    })
  }
}

function drawContactEdges(graphics, npcById, getContactEvents, durationSeconds, clock) {
  const events = getContactEvents({ maxAgeSeconds: durationSeconds })
  const now = getElapsedSimulationSeconds(clock)

  for (const event of events) {
    const age = now === null ? 0 : Math.max(0, now - event.simulationSeconds)
    const alpha = now === null ? 0.68 : Math.max(0.12, 0.68 * (1 - age / Math.max(durationSeconds, 1)))
    const from = currentOrSnapshotPosition(npcById.get(event.sourceNpcId), event.sourcePosition)
    const to = currentOrSnapshotPosition(npcById.get(event.targetNpcId), event.targetPosition)

    if (!from || !to) {
      continue
    }

    strokePolyline(graphics, [from, to], {
      width: DEBUG_EDGE_WIDTH,
      color: INFECTION_CONFIG.colors.susceptible,
      alpha
    })
  }
}

function drawDirectedLine(graphics, from, to, style) {
  if (typeof graphics.moveTo !== 'function') {
    return
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)

  if (length <= 0) {
    return
  }

  const unitX = dx / length
  const unitY = dy / length
  const arrowSize = 9
  const arrowX = to.x - unitX * 5
  const arrowY = to.y - unitY * 5
  const leftX = arrowX - unitX * arrowSize - unitY * arrowSize * 0.55
  const leftY = arrowY - unitY * arrowSize + unitX * arrowSize * 0.55
  const rightX = arrowX - unitX * arrowSize + unitY * arrowSize * 0.55
  const rightY = arrowY - unitY * arrowSize - unitX * arrowSize * 0.55
  const strokeStyle = { width: positiveNumberOrDefault(style.width, 2), color: style.color, alpha: style.alpha }

  graphics.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke(strokeStyle)
  graphics.moveTo(arrowX, arrowY).lineTo(leftX, leftY).moveTo(arrowX, arrowY).lineTo(rightX, rightY).stroke(strokeStyle)
}

function currentOrSnapshotPosition(entity, snapshot) {
  const currentPosition = entity && entity.present !== false
    ? finitePosition(entity.position)
    : null

  return currentPosition || finitePosition(snapshot)
}

function getElapsedSimulationSeconds(clock) {
  if (clock && typeof clock.getElapsedSimulationSeconds === 'function') {
    const seconds = clock.getElapsedSimulationSeconds()

    return Number.isFinite(seconds) ? seconds : null
  }

  return null
}

function createNpcSpriteAtlas(npcs, config = {}, infection = null, pixi = null) {
  const Texture = getPixiMember(pixi, 'Texture')
  const Rectangle = getPixiMember(pixi, 'Rectangle')

  if (!Texture ||
      typeof Texture.from !== 'function' ||
      typeof Texture !== 'function' ||
      typeof Rectangle !== 'function') {
    return null
  }

  const colors = collectNpcSpriteColors(npcs, config, infection)
  const metrics = getNpcSpriteMetrics({ size: getNpcSpriteSize(config) })
  const specs = createNpcSpriteAtlasSpecs(colors, config, metrics)
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
    drawNpcSprite(
      createCanvasGraphics(context),
      {
        id: spec.slot,
        position: {
          x: spec.x + metrics.centerX,
          y: spec.y + metrics.centerY
        },
        sprite: {
          facing: spec.facing,
          walking: spec.frame > 0,
          walkDistance: spec.frame * NPC_SPRITE_FRAME_DISTANCE
        }
      },
      {
        color: spec.color,
        size: spec.size
      }
    )
  }

  const atlasTexture = Texture.from(canvas, true)
  const textures = []
  const colorIndexes = new Map()

  applyNearestSampling(atlasTexture)

  for (let index = 0; index < colors.length; index += 1) {
    colorIndexes.set(colors[index], index)
  }

  for (const spec of specs) {
    const texture = new Texture({
      source: atlasTexture.source,
      frame: new Rectangle(spec.x, spec.y, spec.width, spec.height)
    })

    applyNearestSampling(texture)
    textures[spec.slot] = texture
  }

  return {
    atlasTexture,
    textures,
    colorIndexes,
    defaultSlot: 0,
    defaultTexture: textures[0]
  }
}

function getPixiMember(pixi, key) {
  if (!pixi || !Object.prototype.hasOwnProperty.call(pixi, key)) {
    return null
  }

  return pixi[key]
}

function createNpcSpriteAtlasSpecs(colors, config, metrics) {
  const specs = []
  const size = getNpcSpriteSize(config)

  for (let colorIndex = 0; colorIndex < colors.length; colorIndex += 1) {
    const color = colors[colorIndex]

    for (let facingIndex = 0; facingIndex < NPC_SPRITE_FACINGS.length; facingIndex += 1) {
      const facing = NPC_SPRITE_FACINGS[facingIndex]

      for (let frame = 0; frame < NPC_SPRITE_FRAME_COUNT; frame += 1) {
        specs.push({
          slot: textureSlotFromIds(colorIndex, facingIndex, frame),
          color,
          facing,
          frame,
          size,
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

function getNpcTextureSlot(textureAtlas, npc, color) {
  const colorIndex = textureAtlas.colorIndexes.get(normalizeColor(color))

  if (!Number.isInteger(colorIndex)) {
    return textureAtlas.defaultSlot
  }

  const sprite = npc.sprite || createNpcSpriteState(npc.id)
  const facingIndex = NPC_SPRITE_FACING_IDS[sprite.facing] ?? 0
  const frame = getNpcSpriteFrame(sprite)

  return textureSlotFromIds(colorIndex, facingIndex, frame)
}

function textureSlotFromIds(colorIndex, facingIndex, frame) {
  return colorIndex * NPC_TEXTURES_PER_COLOR + facingIndex * NPC_TEXTURES_PER_FACING + frame
}

function collectNpcSpriteColors(npcs, config, infection) {
  const colors = []
  const seen = new Set()
  const addColor = (color) => {
    const normalized = normalizeColor(color)

    if (!seen.has(normalized)) {
      seen.add(normalized)
      colors.push(normalized)
    }
  }

  addColor(config.color ?? NPC_CONFIG.color)

  for (const color of Object.values(INFECTION_CONFIG.colors)) {
    addColor(color)
  }

  for (const color of Object.values(config.infectionColors || {})) {
    addColor(color)
  }

  for (const color of Object.values(infection?.colors || {})) {
    addColor(color)
  }

  if (infection && typeof infection.getNpcColor === 'function') {
    for (const npc of npcs || []) {
      addColor(infection.getNpcColor(npc))
    }
  }

  return colors
}

function getNpcRenderColor(infection, npc) {
  if (infection && typeof infection.getNpcColor === 'function') {
    return infection.getNpcColor(npc)
  }

  return NPC_CONFIG.color
}

function configureDisplay(display, config) {
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder

  display.eventMode = 'none'
  display.zIndex = zorder
  display.zorder = zorder
}

function getVisibleNpcLimit(config) {
  return Math.min(
    positiveIntegerOrDefault(config.maxVisiblePerTile, NPC_CONFIG.maxVisiblePerTile),
    positiveIntegerOrDefault(config.tileCapacity, NPC_CONFIG.tileCapacity)
  )
}

function tileIndexAtPosition(city, position) {
  const tileX = Math.floor(position.x / city.tileSize)
  const tileY = Math.floor(position.y / city.tileSize)

  if (tileX < 0 || tileY < 0 || tileX >= city.width || tileY >= city.height) {
    return -1
  }

  return tileY * city.width + tileX
}

function reserveVisibleNpcTile(tileIndex, visibleLimit, visibleTileCounts, visibleTileIndexes) {
  if (tileIndex < 0) {
    return true
  }

  const count = visibleTileCounts[tileIndex]

  if (count >= visibleLimit) {
    return false
  }

  if (count === 0) {
    visibleTileIndexes.push(tileIndex)
  }

  visibleTileCounts[tileIndex] = count + 1

  return true
}

function clearVisibleNpcTiles(visibleTileCounts, visibleTileIndexes) {
  for (let index = 0; index < visibleTileIndexes.length; index += 1) {
    visibleTileCounts[visibleTileIndexes[index]] = 0
  }

  visibleTileIndexes.length = 0
}

function getNpcSpriteSize(config) {
  return positiveNumberOrDefault(config.size, NPC_CONFIG.size)
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function positiveNumberOrDefault(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeColor(color) {
  return Number.isInteger(color) ? color & 0xffffff : NPC_CONFIG.color
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
    infectionRadiusVisible: Boolean(debugOptions.infectionRadiusVisible),
    infectionEdgesVisible: Boolean(debugOptions.infectionEdgesVisible),
    contactEdgesVisible: Boolean(debugOptions.contactEdgesVisible),
    infectionEdgeDurationSeconds: positiveNumberOrDefault(
      debugOptions.infectionEdgeDurationSeconds,
      ENTITY_RENDER_DEBUG_CONFIG.infectionEdgeDurationMinutes * 60
    ),
    contactEdgeDurationSeconds: positiveNumberOrDefault(
      debugOptions.contactEdgeDurationSeconds,
      ENTITY_RENDER_DEBUG_CONFIG.contactEdgeDurationMinutes * 60
    ),
    pathTrailsVisible: Boolean(debugOptions.pathTrailsVisible),
    pathTrailLength: positiveIntegerOrDefault(
      debugOptions.pathTrailLength,
      ENTITY_RENDER_DEBUG_CONFIG.pathTrailLength
    )
  }
}
