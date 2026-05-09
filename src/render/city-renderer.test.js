import { describe, expect, it, vi } from 'vitest'
import * as PIXI from 'pixi.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { renderCity } from './city-renderer.js'

vi.mock('pixi.js', () => ({
  Container: class {
    constructor() {
      this.children = []
      this.eventMode = 'auto'
      this.parent = null
      this.sortableChildren = false
      this.cacheAsTextureOptions = null
      this.visible = true
      this.alpha = 1
    }

    addChild(child) {
      this.children.push(child)
      child.parent = this
    }

    removeChildren() {
      const children = this.children

      this.children = []

      for (const child of children) {
        child.parent = null
      }

      return children
    }

    destroy() {}

    cacheAsTexture(options) {
      this.cacheAsTextureOptions = options
    }
  },
  Sprite: class {
    constructor(texture) {
      this.texture = texture
      this.eventMode = 'auto'
      this.roundPixels = false
      this.x = 0
      this.y = 0
      this.width = 0
      this.height = 0
    }

    destroy() {}
  }
}))

function createCity() {
  return compileCityMap(validateCityMap({
    width: 2,
    height: 2,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultTypes: ['residential'],
      items: [
        { id: 'building-0001', types: ['residential'], spans: [[1, 1, 1]] }
      ]
    },
    rows: [
      'ss',
      'sb'
    ],
    textureRows: [
      [0, 0],
      [0, 1]
    ]
  }))
}

describe('city renderer z-ordering', () => {
  it('groups tiles into z-ordered render chunks', () => {
    const city = createCity()
    const layer = new PIXI.Container()
    const textureSet = {
      getTexture: (id) => ({ id })
    }

    const mapTextures = renderCity(city, layer, textureSet)

    const chunkZorders = layer.children.map((chunk) => chunk.zorder).sort((a, b) => a - b)
    const groundChunk = layer.children.find((chunk) => chunk.zorder === 0)
    const buildingChunk = layer.children.find((chunk) => chunk.zorder === 2)

    expect(layer.sortableChildren).toBe(true)
    expect(chunkZorders).toEqual([0, 2])
    expect(groundChunk.children).toHaveLength(3)
    expect(groundChunk.cacheAsTextureOptions).toEqual({ scaleMode: 'nearest' })
    expect(buildingChunk.children).toHaveLength(1)
    expect(buildingChunk.cacheAsTextureOptions).toEqual({ scaleMode: 'nearest' })
    expect(buildingChunk.children[0]).toMatchObject({
      zorder: 2,
      zIndex: 2,
      x: 32,
      y: 32
    })
    expect(mapTextures.chunks).toEqual(layer.children)
    expect(mapTextures.state).toEqual({ visible: true, opacity: 1 })
  })

  it('controls static map texture visibility and opacity', () => {
    const city = createCity()
    const layer = new PIXI.Container()
    const textureSet = {
      getTexture: (id) => ({ id })
    }

    const mapTextures = renderCity(city, layer, textureSet)

    mapTextures.setVisible(false)
    mapTextures.setOpacity(0.35)

    expect(mapTextures.state).toEqual({ visible: false, opacity: 0.35 })
    expect(layer.children.every((chunk) => chunk.visible === false)).toBe(true)
    expect(layer.children.every((chunk) => chunk.alpha === 0.35)).toBe(true)

    mapTextures.setVisible(true)
    mapTextures.setOpacity(2)

    expect(mapTextures.state).toEqual({ visible: true, opacity: 1 })
    expect(layer.children.every((chunk) => chunk.visible === true)).toBe(true)
    expect(layer.children.every((chunk) => chunk.alpha === 1)).toBe(true)
  })
})
