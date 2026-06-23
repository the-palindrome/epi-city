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

function recordMeasurement(label, measurement) {
  process.stdout.write(`[perf] ${label}: ${measurement.ms.toFixed(3)}ms\n`)
}

describe('lane graph performance', () => {
  it('profiles auto traffic signal group construction', () => {
    const graph = createManyIntersectionGraph(1200)
    const optimized = measure(() => buildAutoTrafficSignalGroups(graph.nodes, graph.edges))

    expect(optimized.value.length).toBeGreaterThan(0)
    expect(countEntryEdges(optimized.value)).toBeGreaterThan(0)
    expect(Number.isFinite(optimized.ms)).toBe(true)
    recordMeasurement('auto traffic signal group construction', optimized)
  }, 30000)
})
