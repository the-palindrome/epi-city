import { describe, expect, it } from 'vitest'
import { CROSSWALK_SIGNAL_PHASES } from '../core/constants.js'
import { compileCityMap, validateCityMap, validateCityTextureBindings } from './city-map.js'

function createMap(overrides = {}) {
  return {
    width: 3,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'building-0001', type: 'residential', spans: [[1, 1, 1]] }
      ]
    },
    rows: [
      'sss',
      'sbs',
      'rrr'
    ],
    textureRows: [
      [0, 0, 0],
      [0, 1, 0],
      [2, 2, 2]
    ],
    ...overrides
  }
}

function createCrosswalkMap(overrides = {}) {
  return {
    width: 4,
    height: 2,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      c: { category: 'crosswalk', walkable: true, drivable: true, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: []
    },
    rows: [
      'sccs',
      'rrrr'
    ],
    textureRows: [
      [0, 0, 0, 0],
      [1, 1, 1, 1]
    ],
    ...overrides
  }
}

function createOpenSidewalkMap(overrides = {}) {
  return {
    width: 3,
    height: 3,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: []
    },
    rows: [
      'sss',
      'sss',
      'sss'
    ],
    textureRows: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ],
    ...overrides
  }
}

describe('city map validation and compile', () => {
  it('normalizes valid authoring JSON into the runtime city API', () => {
    const map = validateCityMap(createMap())
    const city = compileCityMap(map)

    expect(map.laneGraph).toMatchObject({
      encoding: 'directed-lanes-v1',
      drivingSide: 'right',
      nodes: [],
      edges: []
    })

    expect(city.getTile(0, 0)).toBe('sidewalk')
    expect(city.getTileVariant(1, 1)).toMatchObject({
      category: 'building',
      textureId: 1,
      zorder: 2,
      buildingId: 'building-0001',
      buildingType: 'residential'
    })
    expect(city.getTileVariant(0, 0)).toMatchObject({
      category: 'sidewalk',
      zorder: 0
    })
    expect(city.tileZOrders[city.index(1, 1)]).toBe(2)
    expect(city.tileZOrders[city.index(0, 0)]).toBe(0)
    expect(city.isWalkable(0, 0)).toBe(true)
    expect(city.isDrivable(0, 2)).toBe(true)
  })

  it('normalizes and compiles fixed vehicle lane graph metadata', () => {
    const laneGraph = {
      encoding: 'directed-lanes-v1',
      drivingSide: 'right',
      coordinateSpace: 'tile',
      nodes: [
        { id: 'lane-a', x: 0.5, y: 2.5, tile: { x: 0, y: 2 }, direction: 'east' },
        { id: 'lane-b', x: 1.5, y: 2.5, tile: { x: 1, y: 2 }, direction: 'east' }
      ],
      edges: [
        {
          id: 'edge-a-b',
          from: 'lane-a',
          to: 'lane-b',
          type: 'lane',
          direction: 'east',
          speedLimit: 28,
          path: [[0.5, 2.5], [1.5, 2.5]]
        }
      ]
    }
    const city = compileCityMap(validateCityMap(createMap({ laneGraph })))

    expect(city.laneGraph.nodes).toHaveLength(2)
    expect(city.laneGraph.edges).toHaveLength(1)
    expect(city.laneGraph.getNode('lane-a')).toMatchObject({ direction: 'east', worldX: 16 })
    expect(city.laneGraph.getOutgoingEdges('lane-a')).toHaveLength(1)
    expect(city.laneGraph.edges[0].worldPath[1]).toEqual([48, 80])
  })

  it('normalizes duplicate directed lane graph edges', () => {
    const laneGraph = {
      encoding: 'directed-lanes-v1',
      drivingSide: 'right',
      coordinateSpace: 'tile',
      nodes: [
        { id: 'lane-a', x: 0.5, y: 2.5, tile: { x: 0, y: 2 }, direction: 'east' },
        { id: 'lane-b', x: 1.5, y: 2.5, tile: { x: 1, y: 2 }, direction: 'east' }
      ],
      edges: [
        {
          id: 'edge-a-b',
          from: 'lane-a',
          to: 'lane-b',
          type: 'lane',
          direction: 'east',
          speedLimit: 28,
          path: [[0.5, 2.5], [1.5, 2.5]]
        },
        {
          id: 'edge-a-b-copy',
          from: 'lane-a',
          to: 'lane-b',
          type: 'lane',
          direction: 'east',
          speedLimit: 28,
          path: [[0.5, 2.5], [1.5, 2.5]]
        }
      ]
    }
    const map = validateCityMap(createMap({ laneGraph }))
    const city = compileCityMap(map)

    expect(map.laneGraph.edges).toHaveLength(1)
    expect(map.laneGraph.edges[0].id).toBe('edge-a-b')
    expect(city.laneGraph.edges).toHaveLength(1)
    expect(city.laneGraph.getOutgoingEdges('lane-a')).toHaveLength(1)
  })

  it('rejects lane graphs with missing edge node references', () => {
    expect(() => validateCityMap(createMap({
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        nodes: [
          { id: 'lane-a', x: 0.5, y: 2.5, tile: { x: 0, y: 2 }, direction: 'east' }
        ],
        edges: [
          {
            id: 'broken',
            from: 'lane-a',
            to: 'missing',
            type: 'lane',
            direction: 'east',
            speedLimit: 28,
            path: [[0.5, 2.5], [1.5, 2.5]]
          }
        ]
      }
    }))).toThrow(/unknown to node/)
  })

  it('rejects legacy generated lane graph metadata', () => {
    expect(() => validateCityMap(createMap({
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        laneOffset: 0.22,
        nodes: [],
        edges: []
      }
    }))).toThrow(/laneOffset is not supported/)
  })

  it('rejects legacy connector lane graph edges', () => {
    expect(() => validateCityMap(createMap({
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        nodes: [
          { id: 'lane-a', x: 0.5, y: 2.5, tile: { x: 0, y: 2 }, direction: 'east' },
          { id: 'lane-b', x: 1.5, y: 2.5, tile: { x: 1, y: 2 }, direction: 'east' }
        ],
        edges: [
          {
            id: 'edge-a-b',
            from: 'lane-a',
            to: 'lane-b',
            type: 'connector',
            direction: 'east',
            speedLimit: 28,
            path: [[0.5, 2.5], [1.5, 2.5]]
          }
        ]
      }
    }))).toThrow(/type/)
  })

  it('rejects lane graph nodes that are not centered on their tile', () => {
    expect(() => validateCityMap(createMap({
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        nodes: [
          { id: 'lane-a', x: 0.5, y: 2.72, tile: { x: 0, y: 2 }, direction: 'east' }
        ],
        edges: []
      }
    }))).toThrow(/center/)
  })

  it('rejects lane graph nodes on drivable non-road tiles', () => {
    expect(() => validateCityMap(createMap({
      legend: {
        r: { category: 'road', walkable: false, drivable: true, parkable: false },
        d: { category: 'obstacle', walkable: false, drivable: true, parkable: false },
        s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false }
      },
      buildings: {
        encoding: 'row-spans-v1',
        defaultType: 'residential',
        items: []
      },
      rows: ['rrr', 'rdr', 'rrr'],
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'right',
        coordinateSpace: 'tile',
        nodes: [
          { id: 'lane-a', x: 1.5, y: 1.5, tile: { x: 1, y: 1 }, direction: 'east' }
        ],
        edges: []
      }
    }))).toThrow(/road or crosswalk tile/)
  })

  it('rejects non-right-side lane graphs', () => {
    expect(() => validateCityMap(createMap({
      laneGraph: {
        encoding: 'directed-lanes-v1',
        drivingSide: 'left',
        coordinateSpace: 'tile',
        nodes: [],
        edges: []
      }
    }))).toThrow(/right-side driving/)
  })

  it('compiles crosswalk tiles as walkable and drivable map cells', () => {
    const city = compileCityMap(validateCityMap(createCrosswalkMap()))

    expect(city.getTile(1, 0)).toBe('crosswalk')
    expect(city.getTileVariant(1, 0)).toMatchObject({
      category: 'crosswalk',
      walkable: true,
      drivable: true
    })
    expect(city.isWalkable(1, 0)).toBe(true)
    expect(city.isDrivable(1, 0)).toBe(true)
    expect(city.isCrosswalk(1, 0)).toBe(true)
  })

  it('keeps building entrance metadata and makes the entrance tile walkable', () => {
    const city = compileCityMap(validateCityMap(createMap({
      buildings: {
        encoding: 'row-spans-v1',
        defaultType: 'residential',
        items: [
          {
            id: 'building-0001',
            type: 'residential',
            entrance: { x: 1, y: 1 },
            spans: [[1, 1, 1]]
          }
        ]
      }
    })))

    expect(city.getTile(1, 1)).toBe('building')
    expect(city.getBuilding(1, 1)).toMatchObject({
      id: 'building-0001',
      entrance: { x: 1, y: 1 }
    })
    expect(city.getTileVariant(1, 1)).toMatchObject({
      category: 'building',
      walkable: true,
      buildingEntrance: true
    })
    expect(city.tileWalkable[city.index(1, 1)]).toBe(1)
    expect(city.isWalkable(1, 1)).toBe(true)
  })

  it('gates pedestrian crosswalk entry by signal state while letting vehicles drive', () => {
    const city = compileCityMap(validateCityMap(createCrosswalkMap()))

    city.setCrosswalkSignalState('green')
    expect(city.canStep(0, 0, 1, 0, 'pedestrian')).toBe(true)
    expect(city.canStepIndex(city.index(0, 0), city.index(1, 0), 'pedestrian')).toBe(true)

    city.setCrosswalkSignalState('yellow')
    expect(city.canStep(0, 0, 1, 0, 'pedestrian')).toBe(false)
    expect(city.canStepIndex(city.index(0, 0), city.index(1, 0), 'pedestrian')).toBe(false)
    expect(city.canStep(1, 0, 2, 0, 'pedestrian')).toBe(true)
    expect(city.canStepIndex(city.index(1, 0), city.index(2, 0), 'pedestrian')).toBe(true)
    expect(city.canStep(2, 0, 3, 0, 'pedestrian')).toBe(true)

    city.setCrosswalkSignalState('red')
    expect(city.canStep(0, 0, 1, 0, 'pedestrian')).toBe(false)
    expect(city.canStepIndex(city.index(0, 0), city.index(1, 0), 'pedestrian')).toBe(false)
    expect(city.canStep(1, 0, 2, 0, 'pedestrian')).toBe(true)
    expect(city.canStepIndex(city.index(1, 0), city.index(2, 0), 'pedestrian')).toBe(true)
    expect(city.canStep(2, 0, 3, 0, 'pedestrian')).toBe(true)
    expect(city.canStep(1, 1, 1, 0, 'vehicle')).toBe(true)
  })

  it('keeps cached pedestrian paths aligned with crosswalk signal state', () => {
    const city = compileCityMap(validateCityMap(createCrosswalkMap()))

    city.setCrosswalkSignalState('red')
    expect(city.findCachedPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 'pedestrian')).toEqual([])

    city.setCrosswalkSignalState('green')
    expect(city.findCachedPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 'pedestrian')).toEqual(
      city.findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 'pedestrian')
    )

    const stats = city.getNavigationCacheStats()

    expect(stats.routeFieldHits).toBeGreaterThanOrEqual(0)
    expect(stats.routeFields).toBeGreaterThanOrEqual(2)
  })

  it('keeps cached route extraction deterministic', () => {
    const city = compileCityMap(validateCityMap(createOpenSidewalkMap()))
    const first = city.findCachedPath({ x: 0, y: 1 }, { x: 2, y: 1 }, 'pedestrian')
    const second = city.findCachedPath({ x: 0, y: 1 }, { x: 2, y: 1 }, 'pedestrian')

    expect(first).toContainEqual({ x: 1, y: 1 })
    expect(second).toEqual(first)
  })

  it('cycles crosswalk signals through red, green, and yellow phases', () => {
    const city = compileCityMap(validateCityMap(createCrosswalkMap()))

    expect(city.getCrosswalkSignalState()).toBe('red')

    city.updateCrosswalkSignals(CROSSWALK_SIGNAL_PHASES[0].duration)
    expect(city.getCrosswalkSignalState()).toBe('green')

    city.updateCrosswalkSignals(CROSSWALK_SIGNAL_PHASES[1].duration)
    expect(city.getCrosswalkSignalState()).toBe('yellow')

    city.updateCrosswalkSignals(CROSSWALK_SIGNAL_PHASES[2].duration)
    expect(city.getCrosswalkSignalState()).toBe('red')
  })

  it('resets crosswalk signals to the initial red phase', () => {
    const city = compileCityMap(validateCityMap(createCrosswalkMap()))

    city.updateCrosswalkSignals(CROSSWALK_SIGNAL_PHASES[0].duration + 1)
    expect(city.getCrosswalkSignalState()).toBe('green')

    city.resetCrosswalkSignals()
    expect(city.getCrosswalkSignalState()).toBe('red')

    city.updateCrosswalkSignals(CROSSWALK_SIGNAL_PHASES[0].duration - 0.1)
    expect(city.getCrosswalkSignalState()).toBe('red')
  })

  it('rejects building metadata that does not cover building tiles', () => {
    expect(() => validateCityMap(createMap({
      buildings: {
        encoding: 'row-spans-v1',
        defaultType: 'residential',
        items: []
      }
    }))).toThrow(/do not cover building tile 1,1/)
  })

  it('rejects a building entrance outside that building footprint', () => {
    expect(() => validateCityMap(createMap({
      buildings: {
        encoding: 'row-spans-v1',
        defaultType: 'residential',
        items: [
          {
            id: 'building-0001',
            type: 'residential',
            entrance: { x: 0, y: 0 },
            spans: [[1, 1, 1]]
          }
        ]
      }
    }))).toThrow(/entrance must be inside that building/)
  })

  it('finds pedestrian paths around blocked cells while reusing path scratch state', () => {
    const city = compileCityMap(validateCityMap(createMap()))

    const first = city.findPath({ x: 0, y: 0 }, { x: 2, y: 1 }, 'pedestrian')
    const second = city.findPath({ x: 2, y: 1 }, { x: 0, y: 0 }, 'pedestrian')

    expect(first.at(0)).toEqual({ x: 0, y: 0 })
    expect(first.at(-1)).toEqual({ x: 2, y: 1 })
    expect(first).not.toContainEqual({ x: 1, y: 1 })
    expect(second.at(0)).toEqual({ x: 2, y: 1 })
    expect(second.at(-1)).toEqual({ x: 0, y: 0 })
  })

  it('validates texture IDs against the loaded texture set', () => {
    const city = compileCityMap(validateCityMap(createMap()))

    expect(() => validateCityTextureBindings(city, {
      name: 'test',
      tileSize: 32,
      frames: [[], [], []]
    })).not.toThrow()

    expect(() => validateCityTextureBindings(city, {
      name: 'test',
      tileSize: 32,
      frames: [[], []]
    })).toThrow(/Texture ID 2/)
  })
})
