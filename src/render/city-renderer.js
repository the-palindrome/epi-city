import * as PIXI from 'pixi.js'
import { clearPixiContainer } from './pixi-rendering.js'

export function renderCity(city, entityLayer, textureSet, options = {}) {
  clearPixiContainer(entityLayer)
  entityLayer.sortableChildren = true

  if (options.mapRenderMode === 'full-canvas' && canRenderStableMap(textureSet)) {
    return renderFullCanvasCity(city, entityLayer, textureSet, options)
  }

  if (options.mapRenderMode === 'stable' && canRenderStableMap(textureSet)) {
    return renderStableCity(city, entityLayer, textureSet, options)
  }

  return renderChunkedCity(city, entityLayer, textureSet, options)
}

function renderChunkedCity(city, entityLayer, textureSet, options = {}) {
  const chunkSize = 16
  const textureScaleMode = options.textureScaleMode || 'nearest'
  const roundPixels = options.roundPixels !== false
  const width = city.width
  const height = city.height
  const tileSize = city.tileSize
  const tileTextureIds = city.tileTextureIds
  const tileZOrders = city.tileZOrders
  const chunks = []

  for (let chunkY = 0; chunkY < height; chunkY += chunkSize) {
    const maxY = Math.min(height, chunkY + chunkSize)

    for (let chunkX = 0; chunkX < width; chunkX += chunkSize) {
      const maxX = Math.min(width, chunkX + chunkSize)
      const chunksByZorder = new Map()

      for (let y = chunkY; y < maxY; y += 1) {
        const rowOffset = y * width

        for (let x = chunkX; x < maxX; x += 1) {
          const index = rowOffset + x
          const textureId = tileTextureIds[index]
          const zorder = tileZOrders[index]
          const texture = textureSet.getTexture(textureId)

          if (!texture) {
            throw new Error(`Missing texture ${textureId} at ${x},${y}.`)
          }

          const chunk = ensureChunkForZorder(entityLayer, chunksByZorder, zorder, chunks)
          const sprite = new PIXI.Sprite(texture)

          sprite.eventMode = 'none'
          sprite.roundPixels = roundPixels
          sprite.zIndex = zorder
          sprite.zorder = zorder
          sprite.x = x * tileSize
          sprite.y = y * tileSize
          sprite.width = tileSize
          sprite.height = tileSize
          chunk.addChild(sprite)
        }
      }

      for (const chunk of chunksByZorder.values()) {
        cacheStaticChunkAsTexture(chunk, textureScaleMode)
      }
    }
  }

  return createMapTextureRenderer(chunks)
}

function renderFullCanvasCity(city, entityLayer, textureSet) {
  const zorders = uniqueSortedZorders(city.tileZOrders)
  const sprites = zorders.map((zorder) => renderFullCanvasMapLayer(city, entityLayer, textureSet, zorder))

  return createMapTextureRenderer(sprites)
}

function renderFullCanvasMapLayer(city, entityLayer, textureSet, zorder) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: true })
  const atlasImage = resolveAtlasImage(textureSet)
  const worldWidth = city.width * city.tileSize
  const worldHeight = city.height * city.tileSize

  canvas.width = worldWidth
  canvas.height = worldHeight
  context.imageSmoothingEnabled = true

  if ('imageSmoothingQuality' in context) {
    context.imageSmoothingQuality = 'high'
  }

  for (let tileY = 0; tileY < city.height; tileY += 1) {
    const rowOffset = tileY * city.width

    for (let tileX = 0; tileX < city.width; tileX += 1) {
      const index = rowOffset + tileX

      if (city.tileZOrders[index] !== zorder) {
        continue
      }

      const frame = textureSet.frames[city.tileTextureIds[index]]

      if (!frame) {
        continue
      }

      context.drawImage(
        atlasImage,
        frame[0],
        frame[1],
        frame[2],
        frame[3],
        tileX * city.tileSize,
        tileY * city.tileSize,
        city.tileSize,
        city.tileSize
      )
    }
  }

  const source = new PIXI.CanvasSource({
    resource: canvas,
    width: worldWidth,
    height: worldHeight,
    resolution: 1,
    scaleMode: 'linear',
    magFilter: 'linear',
    minFilter: 'linear'
  })
  const texture = new PIXI.Texture({ source })
  const sprite = new PIXI.Sprite(texture)

  sprite.eventMode = 'none'
  sprite.roundPixels = false
  sprite.zIndex = zorder
  sprite.zorder = zorder
  sprite.x = 0
  sprite.y = 0
  sprite.width = worldWidth
  sprite.height = worldHeight
  source.update?.()
  entityLayer.addChild(sprite)

  return sprite
}

function renderStableCity(city, entityLayer, textureSet, options = {}) {
  const zorders = uniqueSortedZorders(city.tileZOrders)
  const layers = zorders.map((zorder) => createStableMapLayer(entityLayer, zorder, options))
  const state = {
    visible: true,
    opacity: 1
  }
  const renderState = {
    key: null
  }

  return {
    chunks: layers.map((layer) => layer.sprite),
    layers,
    state,
    render(camera, renderer) {
      if (!camera || !state.visible) {
        return
      }

      const viewport = resolveViewport(renderer, options.stableMapOversample)

      if (!viewport.width || !viewport.height) {
        return
      }

      const key = [
        camera.x,
        camera.y,
        camera.zoom,
        viewport.width,
        viewport.height,
        viewport.resolution
      ].join(':')

      if (key === renderState.key) {
        return
      }

      for (const layer of layers) {
        renderStableMapLayer(layer, city, textureSet, camera, viewport)
      }

      renderState.key = key
    },
    setVisible(visible) {
      state.visible = Boolean(visible)

      for (const layer of layers) {
        layer.sprite.visible = state.visible
      }
    },
    setOpacity(opacity) {
      state.opacity = normalizeAlpha(opacity)

      for (const layer of layers) {
        layer.sprite.alpha = state.opacity
      }
    }
  }
}

function canRenderStableMap(textureSet) {
  return Boolean(
    globalThis.document?.createElement &&
    PIXI.CanvasSource &&
    PIXI.Texture &&
    resolveAtlasImage(textureSet) &&
    Array.isArray(textureSet.frames)
  )
}

function createStableMapLayer(entityLayer, zorder, options = {}) {
  const oversample = normalizeOversample(options.stableMapOversample)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: true })
  const source = new PIXI.CanvasSource({
    resource: canvas,
    width: 1,
    height: 1,
    resolution: oversample,
    scaleMode: 'linear',
    magFilter: 'linear',
    minFilter: 'linear'
  })
  const texture = new PIXI.Texture({ source })
  const sprite = new PIXI.Sprite(texture)

  sprite.eventMode = 'none'
  sprite.roundPixels = false
  sprite.zIndex = zorder
  sprite.zorder = zorder
  sprite.visible = true
  sprite.alpha = 1

  entityLayer.addChild(sprite)

  return {
    canvas,
    context,
    oversample,
    source,
    sprite,
    zorder,
    width: 1,
    height: 1,
    resolution: oversample
  }
}

function renderStableMapLayer(layer, city, textureSet, camera, viewport) {
  resizeStableLayer(layer, viewport)
  positionStableLayer(layer.sprite, camera, viewport)
  drawStableMapLayer(layer, city, textureSet, camera, viewport)
  layer.source.update?.()
}

function resizeStableLayer(layer, viewport) {
  if (
    layer.width === viewport.width &&
    layer.height === viewport.height &&
    layer.resolution === viewport.resolution
  ) {
    return
  }

  layer.width = viewport.width
  layer.height = viewport.height
  layer.resolution = viewport.resolution
  layer.source.resize?.(viewport.width, viewport.height, viewport.resolution)

  if (layer.canvas.width !== Math.max(1, Math.round(viewport.width * viewport.resolution))) {
    layer.canvas.width = Math.max(1, Math.round(viewport.width * viewport.resolution))
  }

  if (layer.canvas.height !== Math.max(1, Math.round(viewport.height * viewport.resolution))) {
    layer.canvas.height = Math.max(1, Math.round(viewport.height * viewport.resolution))
  }
}

function positionStableLayer(sprite, camera, viewport) {
  const zoom = Math.max(0.0001, Number(camera.zoom) || 1)

  sprite.x = -camera.x / zoom
  sprite.y = -camera.y / zoom
  sprite.width = viewport.width / zoom
  sprite.height = viewport.height / zoom
}

function drawStableMapLayer(layer, city, textureSet, camera, viewport) {
  const context = layer.context
  const atlasImage = resolveAtlasImage(textureSet)
  const scale = viewport.resolution
  const zoom = Math.max(0.0001, Number(camera.zoom) || 1)
  const width = city.width
  const height = city.height
  const tileSize = city.tileSize
  const left = -camera.x / zoom
  const top = -camera.y / zoom
  const right = (viewport.width - camera.x) / zoom
  const bottom = (viewport.height - camera.y) / zoom
  const minTileX = clampInteger(Math.floor(left / tileSize) - 1, 0, width - 1)
  const maxTileX = clampInteger(Math.floor(right / tileSize) + 1, 0, width - 1)
  const minTileY = clampInteger(Math.floor(top / tileSize) - 1, 0, height - 1)
  const maxTileY = clampInteger(Math.floor(bottom / tileSize) + 1, 0, height - 1)

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  context.imageSmoothingEnabled = true

  if ('imageSmoothingQuality' in context) {
    context.imageSmoothingQuality = 'high'
  }

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    const rowOffset = tileY * width

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const index = rowOffset + tileX

      if (city.tileZOrders[index] !== layer.zorder) {
        continue
      }

      const frame = textureSet.frames[city.tileTextureIds[index]]

      if (!frame) {
        continue
      }

      const destX0 = Math.round((camera.x + tileX * tileSize * zoom) * scale)
      const destY0 = Math.round((camera.y + tileY * tileSize * zoom) * scale)
      const destX1 = Math.round((camera.x + (tileX + 1) * tileSize * zoom) * scale)
      const destY1 = Math.round((camera.y + (tileY + 1) * tileSize * zoom) * scale)
      const destWidth = destX1 - destX0
      const destHeight = destY1 - destY0

      if (destWidth <= 0 || destHeight <= 0) {
        continue
      }

      context.drawImage(
        atlasImage,
        frame[0],
        frame[1],
        frame[2],
        frame[3],
        destX0,
        destY0,
        destWidth,
        destHeight
      )
    }
  }
}

function ensureChunkForZorder(entityLayer, chunksByZorder, zorder, chunks) {
  if (!chunksByZorder.has(zorder)) {
    const chunk = new PIXI.Container()

    chunk.eventMode = 'none'
    chunk.zIndex = zorder
    chunk.zorder = zorder
    chunk.visible = true
    chunk.alpha = 1
    chunksByZorder.set(zorder, chunk)
    chunks.push(chunk)
    entityLayer.addChild(chunk)
  }

  return chunksByZorder.get(zorder)
}

function cacheStaticChunkAsTexture(chunk, scaleMode) {
  if (typeof chunk.cacheAsTexture === 'function') {
    chunk.cacheAsTexture({ scaleMode })
  }
}

function createMapTextureRenderer(chunks) {
  const state = {
    visible: true,
    opacity: 1
  }

  return {
    chunks,
    state,
    setVisible(visible) {
      state.visible = Boolean(visible)

      for (const chunk of chunks) {
        chunk.visible = state.visible
      }
    },
    setOpacity(opacity) {
      state.opacity = normalizeAlpha(opacity)

      for (const chunk of chunks) {
        chunk.alpha = state.opacity
      }
    }
  }
}

function resolveViewport(renderer, oversample = 1) {
  const rendererResolution = normalizeResolution(renderer?.resolution ?? 1)
  const resolution = rendererResolution * normalizeOversample(oversample)
  const width = Math.max(1, Math.round(
    Number(renderer?.screen?.width ?? renderer?.width ?? globalThis.window?.innerWidth ?? 1)
  ))
  const height = Math.max(1, Math.round(
    Number(renderer?.screen?.height ?? renderer?.height ?? globalThis.window?.innerHeight ?? 1)
  ))

  return {
    width,
    height,
    resolution
  }
}

function normalizeResolution(value) {
  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    return 1
  }

  return number
}

function resolveAtlasImage(textureSet) {
  return textureSet?.atlasImage || textureSet?.atlasResource || textureSet?.atlas?.source?.resource || null
}

function uniqueSortedZorders(zorders) {
  return Array.from(new Set(Array.from(zorders || []))).sort((left, right) => left - right)
}

function clampInteger(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeOversample(value) {
  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    return 1
  }

  return Math.min(Math.max(Math.round(number), 1), 4)
}

function normalizeAlpha(alpha) {
  const value = Number(alpha)

  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.min(Math.max(value, 0), 1)
}
