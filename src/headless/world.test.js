import { describe, expect, it } from 'vitest'
import { createHeadlessWorldFile, normalizeHeadlessWorld } from './world.js'

describe('headless world files', () => {
  it('generates entity snapshots without config or initial SEIR state', async () => {
    const world = await createHeadlessWorldFile({
      seed: { enabled: true, value: 'world-test' },
      population: { npcCount: 100, carCount: 0 }
    })

    expect(world.npcs).toHaveLength(100)
    expect(world.cars).toHaveLength(0)
    expect(world.config).toBeUndefined()
    expect(world.initialSeir).toBeUndefined()
  })

  it('normalizes legacy world fields away from supplied world files', () => {
    const world = normalizeHeadlessWorld({
      npcs: [{ id: 'npc_0', index: 0 }],
      config: { population: { npcCount: 1000, carCount: 200 } },
      initialSeir: {
        infectedNpcIds: ['npc_0'],
        inoculatedNpcIds: ['npc_0']
      }
    })

    expect(world.npcs).toHaveLength(1)
    expect(world.config).toBeUndefined()
    expect(world.initialSeir).toBeUndefined()
  })
})
