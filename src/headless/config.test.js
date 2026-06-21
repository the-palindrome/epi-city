import { describe, expect, it } from 'vitest'
import { metersToWorldUnits } from '../core/scale.js'
import { normalizeRunConfig, normalizeWorldConfig } from './config.js'

describe('headless config normalization', () => {
  it('normalizes world generation config', () => {
    const config = normalizeWorldConfig({
      seed: { enabled: false, value: 123 },
      population: { npcCount: 42, carCount: -5 },
      initialSeir: { initialInfectiousCount: 8, inoculatedPercent: 12.5 }
    })

    expect(config.seed).toEqual({ enabled: false, value: '123' })
    expect(config.population).toEqual({ npcCount: 100, carCount: 0 })
    expect(config.initialSeir).toBeUndefined()
  })

  it('normalizes run config without a world block', () => {
    const config = normalizeRunConfig({
      seed: { value: 'run-seed' },
      initialSeir: {
        initialInfectiousCount: 3,
        inoculatedPercent: 4,
        infectedNpcIds: ['npc_7'],
        inoculatedNpcIds: [8]
      },
      run: { durationHours: 2, stepSeconds: 5 },
      infection: { distanceMeters: 3, transmissionProbabilityPerMinute: 0.4 },
      policies: []
    })

    expect(config.seed).toEqual({ enabled: true, value: 'run-seed' })
    expect(config.world).toBeUndefined()
    expect(config.initialSeir).toEqual({
      initialInfectiousCount: 3,
      inoculatedPercent: 4,
      infectedNpcIds: ['npc_7'],
      inoculatedNpcIds: ['npc_8']
    })
    expect(config.run).toEqual({ durationSeconds: 7200, stepSeconds: 5 })
    expect(config.infection.distanceMeters).toBe(3)
    expect(config.infection.distanceWorldUnits).toBe(metersToWorldUnits(3))
    expect(config.infection.transmissionProbabilityPerMinute).toBe(0.4)
  })

  it('rejects overlapping explicit initial SEIR ids', () => {
    expect(() => normalizeRunConfig({
      initialSeir: {
        infectedNpcIds: ['npc_1'],
        inoculatedNpcIds: ['npc_1']
      }
    })).toThrow(/both infected and inoculated/)
  })
})
