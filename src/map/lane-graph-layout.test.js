import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function loadLibertyCityMap() {
  return JSON.parse(readFileSync(path.join(ROOT, 'public/maps/liberty-city/tile-layout.json'), 'utf8'))
}

function isRoadOrCrosswalk(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return false
  }

  const entry = map.legend[map.rows[y][x]]
  return Boolean(entry && (entry.category === 'road' || entry.category === 'crosswalk'))
}

describe('lane graph map layout', () => {
  it('ships Liberty City without legacy generated lane graph metadata', () => {
    const map = loadLibertyCityMap()

    if (!map.laneGraph) {
      expect(map.laneGraph).toBeUndefined()
      return
    }

    expect(map.laneGraph.generated).toBeUndefined()
    expect(map.laneGraph.laneOffset).toBeUndefined()
    expect(map.laneGraph).toMatchObject({
      encoding: 'directed-lanes-v1',
      drivingSide: 'right',
      coordinateSpace: 'tile'
    })
    expect(Array.isArray(map.laneGraph.nodes)).toBe(true)
    expect(Array.isArray(map.laneGraph.edges)).toBe(true)
  })

  it('keeps Liberty City lane graph nodes centered and edges unique between neighboring tiles', () => {
    const map = loadLibertyCityMap()

    if (!map.laneGraph) {
      expect(map.laneGraph).toBeUndefined()
      return
    }

    const nodesById = new Map()
    const nodeTiles = new Set()
    const edgePairs = new Set()

    for (const node of map.laneGraph.nodes) {
      expect(nodesById.has(node.id)).toBe(false)
      nodesById.set(node.id, node)
      expect(node.x).toBe(node.tile.x + 0.5)
      expect(node.y).toBe(node.tile.y + 0.5)
      expect(isRoadOrCrosswalk(map, node.tile.x, node.tile.y)).toBe(true)

      const tileKey = `${node.tile.x},${node.tile.y}`
      expect(nodeTiles.has(tileKey)).toBe(false)
      nodeTiles.add(tileKey)
    }

    for (const edge of map.laneGraph.edges) {
      const fromNode = nodesById.get(edge.from)
      const toNode = nodesById.get(edge.to)

      expect(fromNode).toBeTruthy()
      expect(toNode).toBeTruthy()
      expect(Math.abs(fromNode.tile.x - toNode.tile.x) + Math.abs(fromNode.tile.y - toNode.tile.y)).toBe(1)

      const edgeKey = `${edge.from}->${edge.to}`
      expect(edgePairs.has(edgeKey)).toBe(false)
      edgePairs.add(edgeKey)
    }
  })

  it('keeps road and crosswalk tiles available for manual lane graph authoring', () => {
    const map = loadLibertyCityMap()
    let roadOrCrosswalkTiles = 0
    let crosswalkTiles = 0

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (isRoadOrCrosswalk(map, x, y)) {
          roadOrCrosswalkTiles += 1
        }

        if (map.legend[map.rows[y][x]].category === 'crosswalk') {
          crosswalkTiles += 1
        }
      }
    }

    expect(roadOrCrosswalkTiles).toBeGreaterThan(0)
    expect(crosswalkTiles).toBeGreaterThan(0)
  })
})
