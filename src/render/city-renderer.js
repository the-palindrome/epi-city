import * as PIXI from 'pixi.js'
import { clearPixiContainer } from './pixi-rendering.js'

export function renderCity(city, mapLayer, textureSet) {
  clearPixiContainer(mapLayer)

  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const chunk = new PIXI.Container()

      chunk.eventMode = 'none'

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          const index = city.index(x, y)
          const texture = textureSet.getTexture(city.tileTextureIds[index])

          if (!texture) {
            throw new Error(`Missing texture ${city.tileTextureIds[index]} at ${x},${y}.`)
          }

          const sprite = new PIXI.Sprite(texture)

          sprite.eventMode = 'none'
          sprite.roundPixels = true
          sprite.x = x * city.tileSize
          sprite.y = y * city.tileSize
          sprite.width = city.tileSize
          sprite.height = city.tileSize
          chunk.addChild(sprite)
        }
      }

      mapLayer.addChild(chunk)
    }
  }
}
