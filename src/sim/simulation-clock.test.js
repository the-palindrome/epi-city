import { describe, expect, it } from 'vitest'
import { SimulationClock, toMovementSeconds, toSimulationSeconds } from './simulation-clock.js'

describe('simulation clock', () => {
  it('advances one simulation hour per real minute at 1x game time', () => {
    const clock = new SimulationClock({ startHour: 8, secondsPerSimulationHour: 60 })

    clock.update(60)

    expect(clock.getTimeOfDayHours()).toBe(9)
    expect(clock.formatTimeOfDay()).toBe('09:00')
  })

  it('converts real seconds to simulation seconds for clock-driven systems', () => {
    const clock = new SimulationClock({ startHour: 8, secondsPerSimulationHour: 60 })

    expect(clock.getSimulationSecondsPerRealSecond()).toBe(60)
    expect(clock.toSimulationSeconds(0.5)).toBe(30)
    expect(toSimulationSeconds(clock, 0.5)).toBe(30)
    expect(toSimulationSeconds({ secondsPerSimulationHour: 120 }, 1)).toBe(30)
  })

  it('converts real seconds to presentation movement seconds without clock compression', () => {
    const clock = new SimulationClock({ startHour: 8, secondsPerSimulationHour: 60 })

    expect(toSimulationSeconds(clock, 0.5)).toBe(30)
    expect(toMovementSeconds(0.5, 4)).toBe(2)
    expect(toMovementSeconds(0.5, 0)).toBe(0.5)
  })

  it('wraps time of day while tracking elapsed days', () => {
    const clock = new SimulationClock({ startHour: 23.5, secondsPerSimulationHour: 60 })

    clock.update(60)

    expect(clock.formatTimeOfDay()).toBe('00:30')
    expect(clock.getDayIndex()).toBe(1)
  })

  it('resets to the configured start hour', () => {
    const clock = new SimulationClock({ startHour: 6, secondsPerSimulationHour: 60 })

    clock.update(120)
    clock.reset()

    expect(clock.formatTimeOfDay()).toBe('06:00')
    expect(clock.getElapsedSimulationSeconds()).toBe(0)
  })
})
