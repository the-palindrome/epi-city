import { describe, expect, it, vi } from 'vitest'
import { createSignalUpdateSystem } from './signal-update-system.js'

describe('signal update system', () => {
  it('advances signals using simulation seconds so lights match car movement time', () => {
    const city = {
      updateCrosswalkSignals: vi.fn(),
      updateTrafficSignals: vi.fn()
    }
    const clock = {
      toSimulationSeconds: vi.fn((deltaSeconds) => deltaSeconds * 60)
    }
    const system = createSignalUpdateSystem(city, clock)

    system.update(0.25)

    expect(clock.toSimulationSeconds).toHaveBeenCalledWith(0.25)
    expect(city.updateCrosswalkSignals).toHaveBeenCalledWith(15)
    expect(city.updateTrafficSignals).toHaveBeenCalledWith(15)
  })

  it('falls back to raw seconds when no simulation clock conversion exists', () => {
    const city = {
      updateCrosswalkSignals: vi.fn(),
      updateTrafficSignals: vi.fn()
    }
    const system = createSignalUpdateSystem(city, null)

    system.update(0.25)

    expect(city.updateCrosswalkSignals).toHaveBeenCalledWith(0.25)
    expect(city.updateTrafficSignals).toHaveBeenCalledWith(0.25)
  })
})
