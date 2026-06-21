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
    expect(config.initialSeir).toEqual({ initialInfectiousCount: 8, inoculatedPercent: 12.5 })
  })

  it('normalizes run config independently from world config', () => {
    const config = normalizeRunConfig({
      world: {
        seed: { value: 'run-world' },
        population: { npcCount: 250, carCount: 12 },
        initialSeir: { initialInfectiousCount: 3, inoculatedPercent: 4 }
      },
      run: { durationHours: 2, stepSeconds: 5 },
      infection: { distanceMeters: 3, transmissionProbabilityPerMinute: 0.4 },
      policies: []
    })

    expect(config.world.population).toEqual({ npcCount: 250, carCount: 12 })
    expect(config.run).toEqual({ durationSeconds: 7200, stepSeconds: 5 })
    expect(config.infection.distanceMeters).toBe(3)
    expect(config.infection.distanceWorldUnits).toBe(metersToWorldUnits(3))
    expect(config.infection.transmissionProbabilityPerMinute).toBe(0.4)
  })
})
