import { describe, expect, it, vi } from 'vitest'
import {
  carPathPoints,
  findSelectableEntityAt,
  npcPathPoints
} from './entity-path-selection.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    clear() {}
    destroy() {}
  }
}))

function createCity() {
  return {
    width: 10,
    height: 10,
    tileSize: 32,
    index: (x, y) => y * 10 + x
  }
}

describe('entity path selection', () => {
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
      movement: {
        target: {
          position: { x: 48, y: 16 },
          routeCursor: 1
        }
      },
      routing: {
        cursor: 1,
        path: [
          city.index(0, 0),
          city.index(1, 0),
          city.index(2, 0)
        ]
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
