import * as PIXI from 'pixi.js'
import { SPRITE_COLORS, TILE_TYPES } from '../core/constants.js'
import { clearPixiContainer, fillRect } from './pixi-rendering.js'

export function renderCity(city, mapLayer, textureSet) {
  clearPixiContainer(mapLayer)

  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const chunk = new PIXI.Container()
      let fallbackGraphics = null

      chunk.eventMode = 'none'

      function fallbackLayer() {
        if (!fallbackGraphics) {
          fallbackGraphics = new PIXI.Graphics()
          fallbackGraphics.eventMode = 'none'
          chunk.addChild(fallbackGraphics)
        }

        return fallbackGraphics
      }

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          const index = city.index(x, y)
          const texture = textureSet && textureSet.getTexture(city.tileTextureIds[index])

          if (texture) {
            const sprite = new PIXI.Sprite(texture)

            sprite.eventMode = 'none'
            sprite.roundPixels = true
            sprite.x = x * city.tileSize
            sprite.y = y * city.tileSize
            sprite.width = city.tileSize
            sprite.height = city.tileSize
            chunk.addChild(sprite)
          } else {
            drawFallbackTile(fallbackLayer(), city, x, y)
          }
        }
      }

      mapLayer.addChild(chunk)
    }
  }
}

function drawFallbackTile(graphics, city, x, y) {
  const tileId = city.tiles[city.index(x, y)]

  if (tileId === TILE_TYPES.road) {
    drawFallbackRoad(graphics, city, x, y)
  } else if (tileId === TILE_TYPES.sidewalk) {
    drawFallbackSidewalk(graphics, city, x, y)
  } else if (tileId === TILE_TYPES.park) {
    drawFallbackPark(graphics, city, x, y)
  } else if (tileId === TILE_TYPES.water) {
    drawFallbackWater(graphics, city, x, y)
  } else if (tileId === TILE_TYPES.building) {
    drawFallbackBuilding(graphics, city, x, y)
  } else if (tileId === TILE_TYPES.obstacle) {
    drawFallbackObstacle(graphics, city, x, y)
  }
}

function drawFallbackRoad(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  fillRect(graphics, px, py, t, t, SPRITE_COLORS.asphalt)
  drawFallbackBoundary(graphics, city, x, y, isRoadLikeId, SPRITE_COLORS.asphaltEdge, 2)
  drawFallbackRoadLane(graphics, city, x, y)
}

function drawFallbackRoadLane(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t
  const horizontal = isRoadLike(city, x - 1, y) || isRoadLike(city, x + 1, y)
  const vertical = isRoadLike(city, x, y - 1) || isRoadLike(city, x, y + 1)

  if (horizontal && !vertical && x % 4 < 2) {
    fillRect(graphics, px + t * 0.25, py + Math.floor(t / 2) - 1, t * 0.5, 2, SPRITE_COLORS.laneMarking, 0.68)
  }

  if (vertical && !horizontal && y % 4 < 2) {
    fillRect(graphics, px + Math.floor(t / 2) - 1, py + t * 0.25, 2, t * 0.5, SPRITE_COLORS.laneMarking, 0.68)
  }
}

function drawFallbackSidewalk(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  fillRect(graphics, px, py, t, t, SPRITE_COLORS.sidewalk)
  drawFallbackBoundary(graphics, city, x, y, isSidewalkLikeId, SPRITE_COLORS.sidewalkEdge, 1)
}

function drawFallbackPark(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  fillRect(graphics, px, py, t, t, SPRITE_COLORS.park)
  drawFallbackBoundary(graphics, city, x, y, isParkLikeId, SPRITE_COLORS.parkEdge, 1)
}

function drawFallbackWater(graphics, city, x, y) {
  const t = city.tileSize

  fillRect(graphics, x * t, y * t, t, t, SPRITE_COLORS.water)
}

function drawFallbackBuilding(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  fillRect(graphics, px, py, t, t, SPRITE_COLORS.building)
  drawFallbackBoundary(graphics, city, x, y, isBuildingLikeId, SPRITE_COLORS.buildingEdge, 2)
}

function drawFallbackObstacle(graphics, city, x, y) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  fillRect(graphics, px, py, t, t, SPRITE_COLORS.obstacle)
  drawFallbackBoundary(graphics, city, x, y, isObstacleLikeId, SPRITE_COLORS.obstacleEdge, 2)
}

function drawFallbackBoundary(graphics, city, x, y, sameGroup, color, thickness) {
  const t = city.tileSize
  const px = x * t
  const py = y * t

  if (!matchesTileGroup(city, x - 1, y, sameGroup)) {
    fillRect(graphics, px, py, thickness, t, color)
  }

  if (!matchesTileGroup(city, x + 1, y, sameGroup)) {
    fillRect(graphics, px + t - thickness, py, thickness, t, color)
  }

  if (!matchesTileGroup(city, x, y - 1, sameGroup)) {
    fillRect(graphics, px, py, t, thickness, color)
  }

  if (!matchesTileGroup(city, x, y + 1, sameGroup)) {
    fillRect(graphics, px, py + t - thickness, t, thickness, color)
  }
}

function matchesTileGroup(city, x, y, predicate) {
  if (!city.inBounds(x, y)) {
    return false
  }

  return predicate(city.tiles[city.index(x, y)])
}

function isRoadLikeId(tileId) {
  return tileId === TILE_TYPES.road
}

function isSidewalkLikeId(tileId) {
  return tileId === TILE_TYPES.sidewalk
}

function isParkLikeId(tileId) {
  return tileId === TILE_TYPES.park
}

function isBuildingLikeId(tileId) {
  return tileId === TILE_TYPES.building
}

function isObstacleLikeId(tileId) {
  return tileId === TILE_TYPES.obstacle
}

function isRoadLike(city, x, y) {
  if (!city.inBounds(x, y)) {
    return false
  }

  return city.tiles[city.index(x, y)] === TILE_TYPES.road
}
