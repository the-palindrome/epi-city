import { describe, expect, it, vi } from 'vitest'
import {
  createEntityPathSelection,
  carPathPoints,
  findSelectableEntityAt,
  npcPathPoints
} from './entity-path-selection.js'

const graphicsState = vi.hoisted(() => ({
  instances: []
}))

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.calls = []
      graphicsState.instances.push(this)
    }

    clear() {
      this.calls.push(['clear'])
      return this
    }

    circle(...args) {
      this.calls.push(['circle', ...args])
      return this
    }

    moveTo(...args) {
      this.calls.push(['moveTo', ...args])
      return this
    }

    lineTo(...args) {
      this.calls.push(['lineTo', ...args])
      return this
    }

    stroke(...args) {
      this.calls.push(['stroke', ...args])
      return this
    }

    destroy() {}
  }
}))

class FakeCanvas {
  constructor() {
    this.eventListeners = {}
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener
  }

  removeEventListener(type, listener) {
    if (this.eventListeners[type] === listener) {
      delete this.eventListeners[type]
    }
  }

  getBoundingClientRect() {
    return { left: 0, top: 0 }
  }
}

function createCity() {
  return {
    width: 10,
    height: 10,
    tileSize: 32,
    tiles: new Uint8Array(100),
    index: (x, y) => y * 10 + x,
    getRouteFieldNextIndex(field, fromIndex) {
      return field.nextByIndex.get(fromIndex) ?? -1
    }
  }
}

describe('entity path selection', () => {
  it('left-click selects an entity without drawing its route until requested', () => {
    graphicsState.instances = []

    const city = createCity()
    const npc = {
      id: 1,
      present: true,
      position: { x: 16, y: 16 },
      tile: { x: 0, y: 0, index: city.index(0, 0) },
      routing: {
        routeField: {
          nextByIndex: new Map([
            [city.index(0, 0), city.index(1, 0)]
          ])
        }
      }
    }
    const canvas = new FakeCanvas()
    const selection = createEntityPathSelection({
      app: { canvas },
      camera: { x: 0, y: 0, zoom: 1 },
      city,
      entityLayer: {
        addChild(child) {
          child.parent = this
        },
        removeChild(child) {
          child.parent = null
        }
      },
      getNpcSimulation: () => ({ npcs: [npc] }),
      getCarSimulation: () => ({ cars: [] }),
      requestRender: vi.fn()
    })

    canvas.eventListeners.mousedown({ button: 0, clientX: 16, clientY: 16 })
    canvas.eventListeners.mouseup({ button: 0, clientX: 16, clientY: 16 })

    const graphics = graphicsState.instances[0]

    expect(selection.selected).toEqual({ kind: 'npc', id: 1, routeVisible: false })
    expect(graphics.calls.some(([name]) => name === 'circle')).toBe(true)
    expect(graphics.calls.some(([name]) => name === 'lineTo')).toBe(false)

    selection.showRouteFor('npc', 1)

    expect(selection.selected).toEqual({ kind: 'npc', id: 1, routeVisible: true })
    expect(graphics.calls.some(([name]) => name === 'lineTo')).toBe(true)

    graphics.calls = []
    selection.hideRouteFor('npc', 1)

    expect(selection.selected).toEqual({ kind: 'npc', id: 1, routeVisible: false })
    expect(selection.isRouteVisibleFor('npc', 1)).toBe(false)
    expect(graphics.calls.some(([name]) => name === 'circle')).toBe(true)
    expect(graphics.calls.some(([name]) => name === 'lineTo')).toBe(false)

    selection.destroy()
  })

  it('hit-tests cars and npcs by their current world positions', () => {
    const city = createCity()
    const npc = {
      id: 1,
      present: true,
      position: { x: 96, y: 96 }
    }
    const car = {
      id: 2,
      state: 'driving',
      lengthTiles: 2,
      direction: { dx: 1, dy: 0 },
      position: { x: 160, y: 96 }
    }

    expect(findSelectableEntityAt({ x: 160, y: 96 }, city, [npc], [car])).toMatchObject({
      kind: 'car',
      entity: car
    })
    expect(findSelectableEntityAt({ x: 96, y: 96 }, city, [npc], [car])).toMatchObject({
      kind: 'npc',
      entity: npc
    })
    expect(findSelectableEntityAt({ x: 20, y: 20 }, city, [npc], [car])).toBeNull()
  })

  it('builds npc path points from current movement and remaining route', () => {
    const city = createCity()
    const npc = {
      present: true,
      position: { x: 16, y: 16 },
      tile: { x: 0, y: 0, index: city.index(0, 0) },
      movement: {
        target: {
          position: { x: 53, y: 10 },
          tile: { x: 1, y: 0, index: city.index(1, 0) }
        }
      },
      routing: {
        routeField: {
          nextByIndex: new Map([
            [city.index(0, 0), city.index(1, 0)],
            [city.index(1, 0), city.index(2, 0)]
          ])
        }
      }
    }

    expect(npcPathPoints(city, npc)).toEqual([
      { x: 16, y: 16 },
      { x: 48, y: 16 },
      { x: 80, y: 16 }
    ])
  })

  it('builds car path points from active movement and remaining lane edges', () => {
    const car = {
      position: { x: 16, y: 16 },
      movement: {
        edge: {
          worldPath: [[0, 0], [48, 16]]
        }
      },
      route: {
        cursor: 1,
        edges: [0, 1]
      }
    }
    const network = {
      edges: [
        { worldPath: [[16, 16], [48, 16]] },
        { worldPath: [[48, 16], [80, 16]] }
      ]
    }

    expect(carPathPoints(car, network)).toEqual([
      { x: 16, y: 16 },
      { x: 48, y: 16 },
      { x: 80, y: 16 }
    ])
  })
})
