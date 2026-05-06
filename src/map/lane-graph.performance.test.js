import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { buildAutoTrafficSignalGroups } from './lane-graph.js'

function createManyIntersectionGraph(count) {
  const nodes = []
  const edges = []
  const columns = Math.ceil(Math.sqrt(count))

  for (let index = 0; index < count; index += 1) {
    const baseX = (index % columns) * 4 + 2
    const baseY = Math.floor(index / columns) * 4 + 2
    const prefix = `i${index}`

    nodes.push(
      { id: `${prefix}-west`, tile: { x: baseX - 1, y: baseY } },
      { id: `${prefix}-center`, tile: { x: baseX, y: baseY } },
      { id: `${prefix}-east`, tile: { x: baseX + 1, y: baseY } },
      { id: `${prefix}-north`, tile: { x: baseX, y: baseY - 1 } },
      { id: `${prefix}-south`, tile: { x: baseX, y: baseY + 1 } }
    )

    edges.push(
      { id: `${prefix}-west-center`, from: `${prefix}-west`, to: `${prefix}-center`, direction: 'east' },
      { id: `${prefix}-east-center`, from: `${prefix}-east`, to: `${prefix}-center`, direction: 'west' },
      { id: `${prefix}-north-center`, from: `${prefix}-north`, to: `${prefix}-center`, direction: 'south' },
      { id: `${prefix}-south-center`, from: `${prefix}-south`, to: `${prefix}-center`, direction: 'north' }
    )
  }

  return { nodes, edges }
}

function buildAutoTrafficSignalGroupsLegacy(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const axesByNodeId = new Map(nodes.map((node) => [node.id, new Set()]))

  for (const edge of edges) {
    const axis = axisForDirection(edge.direction)

    if (!axis) {
      continue
    }

    const fromNode = nodesById.get(edge.from)
    const toNode = nodesById.get(edge.to)

    if (fromNode && axesByNodeId.has(fromNode.id)) {
      axesByNodeId.get(fromNode.id).add(axis)
    }

    if (toNode && axesByNodeId.has(toNode.id)) {
      axesByNodeId.get(toNode.id).add(axis)
    }
  }

  const candidateTiles = []
  const candidateKeys = new Set()

  for (const node of nodes) {
    const axes = axesByNodeId.get(node.id)

    if (!axes || axes.size < 2) {
      continue
    }

    const key = tileKey(node.tile)
    candidateKeys.add(key)
    candidateTiles.push({ x: node.tile.x, y: node.tile.y })
  }

  candidateTiles.sort(compareTiles)

  const groups = []
  const visited = new Set()

  for (const tile of candidateTiles) {
    const startKey = tileKey(tile)

    if (visited.has(startKey)) {
      continue
    }

    const tiles = []
    const stack = [tile]
    visited.add(startKey)

    while (stack.length > 0) {
      const current = stack.pop()
      tiles.push(current)

      for (const offset of CARDINAL_OFFSETS) {
        const nextTile = { x: current.x + offset.dx, y: current.y + offset.dy }
        const nextKey = tileKey(nextTile)

        if (!candidateKeys.has(nextKey) || visited.has(nextKey)) {
          continue
        }

        visited.add(nextKey)
        stack.push(nextTile)
      }
    }

    tiles.sort(compareTiles)

    const entryEdges = trafficSignalEntryEdgesLegacy(edges, nodesById, tiles)
    const entryAxes = new Set(entryEdges.map((entry) => entry.axis))

    if (entryAxes.size < 2) {
      continue
    }

    const anchor = tiles[0]

    groups.push({
      id: `traffic-signal-${anchor.x}-${anchor.y}`,
      tile: { ...anchor },
      tiles: tiles.map((groupTile) => ({ ...groupTile })),
      entryEdges
    })
  }

  return groups
}

function trafficSignalEntryEdgesLegacy(edges, nodesById, tiles) {
  const tileKeys = new Set(tiles.map(tileKey))
  const entryEdges = []

  for (const edge of edges) {
    const fromNode = nodesById.get(edge.from)
    const toNode = nodesById.get(edge.to)

    if (!fromNode || !toNode) {
      continue
    }

    const fromInside = tileKeys.has(tileKey(fromNode.tile))
    const toInside = tileKeys.has(tileKey(toNode.tile))

    if (fromInside || !toInside) {
      continue
    }

    const axis = axisForDirection(edge.direction)

    if (axis) {
      entryEdges.push({
        edgeId: edge.id,
        axis,
        direction: edge.direction
      })
    }
  }

  entryEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId))
  return entryEdges
}

function measure(fn) {
  const start = performance.now()
  const value = fn()

  return {
    value,
    ms: performance.now() - start
  }
}

function countEntryEdges(groups) {
  let total = 0

  for (const group of groups) {
    total += group.entryEdges.length
  }

  return total
}

function axisForDirection(direction) {
  if (direction === 'north' || direction === 'south') {
    return 'north-south'
  }

  if (direction === 'east' || direction === 'west') {
    return 'east-west'
  }

  return null
}

function tileKey(tile) {
  return `${tile.x},${tile.y}`
}

function compareTiles(a, b) {
  return a.y - b.y || a.x - b.x
}

const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: -1, dy: 0 })
])

describe('lane graph performance', () => {
  it('builds auto traffic signal groups at least 10x faster than group-by-group edge scans', () => {
    const graph = createManyIntersectionGraph(1200)
    const legacy = measure(() => buildAutoTrafficSignalGroupsLegacy(graph.nodes, graph.edges))
    const optimized = measure(() => buildAutoTrafficSignalGroups(graph.nodes, graph.edges))
    const speedup = legacy.ms / Math.max(optimized.ms, 0.001)

    expect(optimized.value).toHaveLength(legacy.value.length)
    expect(countEntryEdges(optimized.value)).toBe(countEntryEdges(legacy.value))
    expect(speedup).toBeGreaterThanOrEqual(10)
  }, 30000)
})
