import { afterEach, describe, expect, it, vi } from 'vitest'
import * as PIXI from 'pixi.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { renderCity } from './city-renderer.js'

vi.mock('pixi.js', () => ({
  CanvasSource: class {
    constructor(options = {}) {
      this.resource = options.resource
      this.width = options.width || 1
      this.height = options.height || 1
      this.resolution = options.resolution || 1
      this.scaleMode = options.scaleMode
      this.magFilter = options.magFilter
      this.minFilter = options.minFilter
      this.resizeCalls = []
      this.updateCount = 0
    }

    resize(width, height, resolution = this.resolution) {
      this.width = width
      this.height = height
      this.resolution = resolution
      this.resource.width = Math.round(width * resolution)
      this.resource.height = Math.round(height * resolution)
      this.resizeCalls.push({ width, height, resolution })
    }

    update() {
      this.updateCount += 1
    }
  },
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
  Texture: class {
    constructor(options = {}) {
      this.source = options.source
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
      this.visible = true
      this.alpha = 1
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

const originalDocument = globalThis.document

afterEach(() => {
  if (originalDocument === undefined) {
    delete globalThis.document
  } else {
    globalThis.document = originalDocument
  }
})

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
    expect(groundChunk.children.every((sprite) => sprite.eventMode === 'none')).toBe(true)
    expect(groundChunk.children.every((sprite) => sprite.roundPixels === true)).toBe(true)
    expect(buildingChunk.children).toHaveLength(1)
    expect(buildingChunk.cacheAsTextureOptions).toEqual({ scaleMode: 'nearest' })
    expect(buildingChunk.children[0].eventMode).toBe('none')
    expect(buildingChunk.children[0].roundPixels).toBe(true)
    expect(buildingChunk.children[0]).toMatchObject({
      zorder: 2,
      zIndex: 2,
      x: 32,
      y: 32
    })
    expect(mapTextures.chunks).toEqual(layer.children)
    expect(mapTextures.state).toEqual({ visible: true, opacity: 1 })
  })

  it('renders stable viewport map layers for video mode', () => {
    const city = createCity()
    const layer = new PIXI.Container()
    const canvases = installFakeDocument()
    const textureSet = {
      atlasImage: { id: 'atlas' },
      frames: [
        [0, 0, 13, 13],
        [13, 0, 13, 13]
      ],
      getTexture: (id) => ({ id })
    }

    const mapTextures = renderCity(city, layer, textureSet, {
      mapRenderMode: 'stable',
      stableMapOversample: 2
    })

    expect(layer.children.map((sprite) => sprite.zorder)).toEqual([0, 2])
    expect(layer.children.every((sprite) => sprite.roundPixels === false)).toBe(true)
    expect(layer.children.every((sprite) => sprite.eventMode === 'none')).toBe(true)
    expect(layer.children.every((sprite) => sprite.cacheAsTextureOptions === undefined)).toBe(true)

    mapTextures.render(
      { x: 0, y: 0, zoom: 0.5 },
      { screen: { width: 64, height: 64 }, resolution: 1 }
    )

    expect(canvases).toHaveLength(2)
    expect(canvases.every((canvas) => canvas.width === 128 && canvas.height === 128)).toBe(true)
    expect(mapTextures.layers[0].context.drawImageCalls).toHaveLength(3)
    expect(mapTextures.layers[1].context.drawImageCalls).toHaveLength(1)
    expect(mapTextures.layers[0].source.updateCount).toBe(1)
    expect(mapTextures.layers[1].source.updateCount).toBe(1)
    expect(layer.children[0]).toMatchObject({
      x: -0,
      y: -0,
      width: 128,
      height: 128
    })
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

function installFakeDocument() {
  const canvases = []

  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected element: ${tagName}`)
      }

      const canvas = new FakeCanvas()

      canvases.push(canvas)
      return canvas
    }
  }

  return canvases
}

class FakeCanvas {
  constructor() {
    this.width = 1
    this.height = 1
    this.context = new FakeContext()
  }

  getContext(type) {
    if (type !== '2d') {
      return null
    }

    return this.context
  }
}

class FakeContext {
  constructor() {
    this.drawImageCalls = []
    this.clearRectCalls = []
    this.setTransformCalls = []
    this.imageSmoothingEnabled = false
    this.imageSmoothingQuality = 'low'
  }

  setTransform(...args) {
    this.setTransformCalls.push(args)
  }

  clearRect(...args) {
    this.clearRectCalls.push(args)
  }

  drawImage(...args) {
    this.drawImageCalls.push(args)
  }
}
