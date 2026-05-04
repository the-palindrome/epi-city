import { describe, expect, it, vi } from 'vitest'
import { createSeededRandom } from '../core/random.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { createNpcSimulation } from './npc-simulation.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
    }

    clear() {}

    rect() {
      return {
        fill() {}
      }
    }

    destroy() {}
  }
}))

function createCity(overrides = {}) {
  return compileCityMap(validateCityMap({
    width: 4,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false }
    },
    rows: [
      'ssss',
      'ssss',
      'ssss'
    ],
    textureRows: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ],
    ...overrides
  }))
}

function createCityWithBuildingTypes() {
  return createCity({
    width: 9,
    height: 3,
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'home-1', type: 'residential', entrance: { x: 1, y: 1 }, spans: [[1, 1, 1]] },
        { id: 'home-2', type: 'residential', entrance: { x: 3, y: 1 }, spans: [[1, 3, 1]] },
        { id: 'work-1', type: 'commercial', entrance: { x: 5, y: 1 }, spans: [[1, 5, 1]] },
        { id: 'work-2', type: 'commercial', entrance: { x: 7, y: 1 }, spans: [[1, 7, 1]] }
      ]
    },
    rows: [
      'sssssssss',
      'sbsbsbsbs',
      'sssssssss'
    ],
    textureRows: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]
  })
}

function createActorLayer() {
  return {
    eventMode: 'auto',
    children: [],
    addChild(child) {
      this.children.push(child)
      child.parent = this
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      child.parent = null
    }
  }
}

function createSimulation(seed, city = createCity()) {
  const simulation = createNpcSimulation(city, createActorLayer(), {
    count: 8,
    zorder: 1,
    tileCapacity: 2,
    slotSpacing: 11,
    color: 0xe5c748,
    size: 9,
    minSpeed: 34,
    maxSpeed: 58,
    random: createSeededRandom(seed)
  })

  simulation.update(1 / 60)

  return simulation
}

function snapshot(simulation) {
  return simulation.npcs.map((npc) => ({
    zorder: npc.zorder,
    home: npc.home,
    work: npc.work,
    position: { ...npc.position },
    tile: { ...npc.tile },
    slot: { ...npc.slot },
    speed: npc.movement.speed,
    target: npc.movement.target
      ? {
          position: { ...npc.movement.target.position },
          tile: { ...npc.movement.target.tile },
          slot: { ...npc.movement.target.slot }
        }
      : null
  }))
}

describe('NPC simulation randomness', () => {
  it('assigns NPC entities and their graphics layer to zorder 1', () => {
    const simulation = createSimulation('zorder')

    expect(simulation.npcs.every((npc) => npc.zorder === 1)).toBe(true)
    expect(simulation.graphics.zorder).toBe(1)
    expect(simulation.graphics.zIndex).toBe(1)

    simulation.destroy()
  })

  it('assigns each NPC a residential home and commercial work building', () => {
    const city = createCityWithBuildingTypes()
    const simulation = createSimulation('building-assignments', city)
    const repeated = createSimulation('building-assignments', city)
    const homeIds = new Set(['home-1', 'home-2'])
    const workIds = new Set(['work-1', 'work-2'])
    const assignments = simulation.npcs.map((npc) => ({ home: npc.home, work: npc.work }))

    expect(simulation.npcs.every((npc) => homeIds.has(npc.home))).toBe(true)
    expect(simulation.npcs.every((npc) => workIds.has(npc.work))).toBe(true)
    expect(assignments).toEqual(repeated.npcs.map((npc) => ({ home: npc.home, work: npc.work })))

    simulation.destroy()
    repeated.destroy()
  })

  it('recreates the same spawn and first movement state with the same seed', () => {
    const first = createSimulation('repeatable')
    const second = createSimulation('repeatable')

    expect(snapshot(first)).toEqual(snapshot(second))

    first.destroy()
    second.destroy()
  })

  it('changes spawn or movement state when the seed changes', () => {
    const first = createSimulation('repeatable')
    const second = createSimulation('different')

    expect(snapshot(first)).not.toEqual(snapshot(second))

    first.destroy()
    second.destroy()
  })
})
