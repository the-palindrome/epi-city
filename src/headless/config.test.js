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
      export: {
        events: ['infection', 'recovery', 'infection'],
        omitEvents: 'recovery,policy_effect_change'
      },
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
    expect(config.export).toEqual({
      events: ['infection', 'recovery'],
      omitEvents: ['recovery', 'policy_effect_change']
    })
  })

  it('does not add an implicit seed to run configs', () => {
    const config = normalizeRunConfig({
      initialSeir: { initialInfectiousCount: 1 },
      run: { durationSeconds: 10, stepSeconds: 2 },
      infection: { transmissionProbabilityPerMinute: 0.001 },
      policies: []
    })

    expect(config.seed).toBeUndefined()
    expect(config.export).toEqual({
      events: [],
      omitEvents: []
    })
  })

  it('rejects unknown run config export event types', () => {
    expect(() => normalizeRunConfig({
      export: {
        events: ['infection', 'made_up_event']
      }
    })).toThrow(/Unknown headless event type "made_up_event" for export\.events/)
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
