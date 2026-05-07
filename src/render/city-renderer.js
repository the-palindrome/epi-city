import * as PIXI from 'pixi.js'
import { clearPixiContainer } from './pixi-rendering.js'

export function renderCity(city, entityLayer, textureSet) {
  clearPixiContainer(entityLayer)
  entityLayer.sortableChildren = true

  const chunkSize = 16
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
          sprite.roundPixels = true
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
        cacheStaticChunkAsTexture(chunk)
      }
    }
  }

  return createMapTextureRenderer(chunks)
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

function cacheStaticChunkAsTexture(chunk) {
  if (typeof chunk.cacheAsTexture === 'function') {
    chunk.cacheAsTexture({ scaleMode: 'nearest' })
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

function normalizeAlpha(alpha) {
  const value = Number(alpha)

  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.min(Math.max(value, 0), 1)
}
