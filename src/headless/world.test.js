import { describe, expect, it } from 'vitest'
import { createHeadlessWorldFile, normalizeHeadlessWorld } from './world.js'

describe('headless world files', () => {
  it('materializes editable initial SEIR id lists', async () => {
    const world = await createHeadlessWorldFile({
      seed: { enabled: true, value: 'world-test' },
      population: { npcCount: 100, carCount: 0 },
      initialSeir: { initialInfectiousCount: 3, inoculatedPercent: 5 }
    })

    expect(world.npcs).toHaveLength(100)
    expect(world.initialSeir.infectedNpcIds).toHaveLength(3)
    expect(world.initialSeir.inoculatedNpcIds).toHaveLength(5)
    expect(new Set([
      ...world.initialSeir.infectedNpcIds,
      ...world.initialSeir.inoculatedNpcIds
    ]).size).toBe(8)
  })

  it('rejects invalid or overlapping initial SEIR ids', () => {
    expect(() => normalizeHeadlessWorld({
      npcs: [{ id: 'npc_0', index: 0 }],
      initialSeir: {
        infectedNpcIds: ['npc_0'],
        inoculatedNpcIds: ['npc_0']
      }
    })).toThrow(/both infected and inoculated/)

    expect(() => normalizeHeadlessWorld({
      npcs: [{ id: 'npc_0', index: 0 }],
      initialSeir: {
        infectedNpcIds: ['npc_1'],
        inoculatedNpcIds: []
      }
    })).toThrow(/unknown NPC id/)
  })
})
