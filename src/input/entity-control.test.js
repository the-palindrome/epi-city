import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityControl } from './entity-control.js'

function createDocument() {
  const eventListeners = {}

  return {
    eventListeners,
    addEventListener(type, listener) {
      eventListeners[type] = listener
    },
    removeEventListener(type, listener) {
      if (eventListeners[type] === listener) {
        delete eventListeners[type]
      }
    }
  }
}

function createCity(overrides = {}) {
  const width = overrides.width || 6
  const height = overrides.height || 4
  const tileSize = overrides.tileSize || 10
  const blocked = new Set(overrides.blocked || [])

  function index(x, y) {
    return y * width + x
  }

  function tileKey(x, y) {
    return `${x},${y}`
  }

  return {
    width,
    height,
    tileSize,
    index,
    inBounds: (x, y) => x >= 0 && y >= 0 && x < width && y < height,
    isCrosswalk: () => false,
    isPassable(x, y) {
      return x >= 0 && y >= 0 && x < width && y < height && !blocked.has(tileKey(x, y))
    },
    canStepIndex(fromIndex, toIndex) {
      const fromX = fromIndex % width
      const fromY = Math.floor(fromIndex / width)
      const toX = toIndex % width
      const toY = Math.floor(toIndex / width)

      return Math.abs(toX - fromX) <= 1 &&
        Math.abs(toY - fromY) <= 1 &&
        !blocked.has(tileKey(toX, toY))
    },
    nearestPassableTile(x, y) {
      return { x, y }
    }
  }
}

function keyEvent(code, overrides = {}) {
  return {
    code,
    key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
    target: { tagName: 'BODY' },
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides
  }
}

describe('entity keyboard control', () => {
  const originalDocument = globalThis.document

  beforeEach(() => {
    globalThis.document = createDocument()
  })

  afterEach(() => {
    globalThis.document = originalDocument
  })

  it('assumes control of an NPC and moves it with WASD without leaking dashboard hotkeys', () => {
    const city = createCity()
    const npc = {
      id: 1,
      present: true,
      position: { x: 15, y: 15 },
      tile: { x: 1, y: 1, index: city.index(1, 1) },
      slot: { id: 0 },
      movement: {
        speed: 100,
        target: { position: { x: 25, y: 15 } },
        headingX: 1,
        headingY: 0
      },
      routing: { routeField: {} },
      sprite: {}
    }
    const requestRender = vi.fn()
    const control = createEntityControl({
      city,
      getNpcSimulation: () => ({ npcs: [npc] }),
      getCarSimulation: () => ({ cars: [] }),
      requestRender
    })

    expect(control.assumeControl('npc', 1)).toBe(true)
    expect(control.controlled).toEqual({ kind: 'npc', id: 1 })
    expect(npc.manualControl).toBe(true)
    expect(npc.movement.target).toBeNull()
    expect(npc.routing.routeField).toBeNull()

    const event = keyEvent('KeyS')

    globalThis.document.eventListeners.keydown(event)
    control.update(1 / 60)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(npc.position.y).toBeGreaterThan(15)
    expect(npc.tile).toMatchObject({ x: 1, y: 2, index: city.index(1, 2) })
    expect(requestRender).toHaveBeenCalled()

    globalThis.document.eventListeners.keyup(keyEvent('KeyS'))
    control.destroy()
  })

  it('keeps controlled NPCs out of blocked tiles', () => {
    const city = createCity({ blocked: ['2,1'] })
    const npc = {
      id: 1,
      present: true,
      position: { x: 15, y: 15 },
      tile: { x: 1, y: 1, index: city.index(1, 1) },
      slot: { id: 0 },
      movement: { speed: 100, target: null, headingX: 0, headingY: 0 },
      routing: {},
      sprite: {}
    }
    const control = createEntityControl({
      city,
      getNpcSimulation: () => ({ npcs: [npc] }),
      getCarSimulation: () => ({ cars: [] })
    })

    control.assumeControl('npc', 1)
    globalThis.document.eventListeners.keydown(keyEvent('KeyD'))
    control.update(1)

    expect(npc.position.x).toBe(15)
    expect(npc.tile).toMatchObject({ x: 1, y: 1, index: city.index(1, 1) })

    control.destroy()
  })

  it('assumes control of a car, freezes its route, and moves it on drivable tiles', () => {
    const city = createCity()
    const car = {
      id: 3,
      state: 'driving',
      position: { x: 15, y: 15 },
      direction: { dx: 1, dy: 0 },
      lengthTiles: 2,
      manualControlSpeed: 100,
      occupiedTiles: [city.index(1, 1)],
      route: { edges: [1], cursor: 0 },
      movement: { edgeIndex: 1 },
      destinationParkingSpot: { tileIndexes: [city.index(3, 1)] }
    }
    const parking = {
      canOccupy: vi.fn(() => true),
      occupyTiles: vi.fn((entity, tileIndexes) => {
        entity.occupiedTiles = tileIndexes
      }),
      releaseOccupiedTiles: vi.fn((entity) => {
        entity.occupiedTiles = []
      }),
      releaseParkingReservation: vi.fn()
    }
    const trafficReservations = {
      canOccupy: vi.fn(() => true),
      releaseForCar: vi.fn()
    }
    const control = createEntityControl({
      city,
      getNpcSimulation: () => ({ npcs: [] }),
      getCarSimulation: () => ({ cars: [car], parking, trafficReservations })
    })

    expect(control.assumeControl('car', 3)).toBe(true)
    expect(car.manualControl).toBe(true)
    expect(car.state).toBe('manual')
    expect(car.route).toBeNull()
    expect(car.movement).toBeNull()
    expect(parking.releaseParkingReservation).toHaveBeenCalledWith([city.index(3, 1)], 3)

    globalThis.document.eventListeners.keydown(keyEvent('KeyD'))
    control.update(0.05)

    expect(car.position.x).toBeGreaterThan(15)
    expect(car.direction).toEqual({ dx: 1, dy: 0 })
    expect(parking.occupyTiles).toHaveBeenLastCalledWith(car, [city.index(2, 1), city.index(1, 1)])

    control.destroy()
  })

  it('ignores movement keys inside text entry controls', () => {
    const city = createCity()
    const npc = {
      id: 1,
      present: true,
      position: { x: 15, y: 15 },
      tile: { x: 1, y: 1, index: city.index(1, 1) },
      slot: { id: 0 },
      movement: { speed: 10, target: null, headingX: 0, headingY: 0 },
      routing: {},
      sprite: {}
    }
    const control = createEntityControl({
      city,
      getNpcSimulation: () => ({ npcs: [npc] }),
      getCarSimulation: () => ({ cars: [] })
    })
    const event = keyEvent('KeyW', { target: { tagName: 'INPUT' } })

    control.assumeControl('npc', 1)
    globalThis.document.eventListeners.keydown(event)
    control.update(1)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(npc.position.y).toBe(15)

    control.destroy()
  })
})
