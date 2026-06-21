import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runHeadlessSimulation } from './simulation.js'
import { createHeadlessWorldFile } from './world.js'

describe('headless simulation runner', () => {
  it('uses a supplied world file instead of the run config world block', async () => {
    const world = await createHeadlessWorldFile({
      seed: { enabled: true, value: 'supplied-world' },
      population: { npcCount: 100, carCount: 0 },
      initialSeir: { initialInfectiousCount: 0, inoculatedPercent: 0 }
    })
    const worldPath = path.resolve('tmp', 'headless-supplied-world.test.json')

    world.initialSeir = {
      infectedNpcIds: ['npc_0'],
      inoculatedNpcIds: ['npc_1']
    }

    await fs.mkdir(path.dirname(worldPath), { recursive: true })
    await fs.writeFile(worldPath, JSON.stringify(world), 'utf8')

    const results = await runHeadlessSimulation({
      world: {
        seed: { enabled: true, value: 'ignored-world' },
        population: { npcCount: 500, carCount: 200 },
        initialSeir: { initialInfectiousCount: 20, inoculatedPercent: 10 }
      },
      run: { durationSeconds: 1, stepSeconds: 1 },
      infection: {
        distanceMeters: 0,
        transmissionProbabilityPerMinute: 0,
        incubationDays: 1,
        infectiousDays: 7,
        immunityDays: 90
      },
      policies: []
    }, { worldPath })

    expect(results.world).toMatchObject({
      source: 'file',
      path: worldPath,
      runConfigWorldIgnored: true
    })
    expect(results.npcs).toHaveLength(100)
    expect(results.npcs.find((npc) => npc.id === 'npc_0').initialSeirState).toBe('infectious')
    expect(results.npcs.find((npc) => npc.id === 'npc_1').initialSeirState).toBe('recovered')
    expect(results.summary.finalSeir).toMatchObject({
      susceptible: 98,
      infectious: 1,
      recovered: 1
    })
  })
})
