import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runHeadlessSimulation } from './simulation.js'
import { createHeadlessWorldFile } from './world.js'

describe('headless simulation runner', () => {
  it('requires a supplied world file', async () => {
    await expect(runHeadlessSimulation(createRunConfig())).rejects.toThrow(/requires a generated world file/)
  })

  it('applies explicit run config initial SEIR ids', async () => {
    const worldPath = await writeTestWorld('headless-explicit-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    const results = await runHeadlessSimulation(createRunConfig({
      initialInfectiousCount: 20,
      inoculatedPercent: 10,
      infectedNpcIds: ['npc_0'],
      inoculatedNpcIds: ['npc_1']
    }), { worldPath })

    expect(results.world).toEqual({
      source: 'file',
      path: worldPath
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

  it('applies count and percent initial SEIR without overlap', async () => {
    const worldPath = await writeTestWorld('headless-random-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    const results = await runHeadlessSimulation(createRunConfig({
      initialInfectiousCount: 4,
      inoculatedPercent: 5,
      infectedNpcIds: [],
      inoculatedNpcIds: []
    }), { worldPath })
    const initialStateCounts = results.npcs.reduce((counts, npc) => {
      counts[npc.initialSeirState] = (counts[npc.initialSeirState] || 0) + 1
      return counts
    }, {})

    expect(initialStateCounts).toMatchObject({
      susceptible: 91,
      infectious: 4,
      recovered: 5
    })
    expect(results.summary.finalSeir).toMatchObject({
      susceptible: 91,
      infectious: 4,
      recovered: 5
    })
  })

  it('rejects explicit initial SEIR ids outside the supplied world', async () => {
    const worldPath = await writeTestWorld('headless-invalid-seir-world.test.json', {
      population: { npcCount: 100, carCount: 0 }
    })

    await expect(runHeadlessSimulation(createRunConfig({
      infectedNpcIds: ['npc_100']
    }), { worldPath })).rejects.toThrow(/unknown NPC id/)
  })
})

async function writeTestWorld(fileName, config) {
  const world = await createHeadlessWorldFile({
    seed: { enabled: true, value: fileName },
    ...config
  })
  const worldPath = path.resolve('tmp', fileName)

  await fs.mkdir(path.dirname(worldPath), { recursive: true })
  await fs.writeFile(worldPath, JSON.stringify(world), 'utf8')

  return worldPath
}

function createRunConfig(initialSeir = {}) {
  return {
    seed: { enabled: true, value: 'run-seed' },
    initialSeir: {
      initialInfectiousCount: 0,
      inoculatedPercent: 0,
      infectedNpcIds: [],
      inoculatedNpcIds: [],
      ...initialSeir
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
  }
}
