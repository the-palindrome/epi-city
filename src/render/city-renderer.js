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

          const chunk = ensureChunkForZorder(entityLayer, chunksByZorder, zorder)
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
}

function ensureChunkForZorder(entityLayer, chunksByZorder, zorder) {
  if (!chunksByZorder.has(zorder)) {
    const chunk = new PIXI.Container()

    chunk.eventMode = 'none'
    chunk.zIndex = zorder
    chunk.zorder = zorder
    chunksByZorder.set(zorder, chunk)
    entityLayer.addChild(chunk)
  }

  return chunksByZorder.get(zorder)
}

function cacheStaticChunkAsTexture(chunk) {
  if (typeof chunk.cacheAsTexture === 'function') {
    chunk.cacheAsTexture({ scaleMode: 'nearest' })
  }
}
