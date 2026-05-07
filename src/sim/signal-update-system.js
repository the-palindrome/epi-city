import { toSimulationSeconds } from './simulation-clock.js'

export function createSignalUpdateSystem(city, clock) {
  return {
    update(deltaSeconds) {
      const signalDeltaSeconds = toSimulationSeconds(clock, deltaSeconds)

      city.updateCrosswalkSignals(signalDeltaSeconds)
      city.updateTrafficSignals(signalDeltaSeconds)
    }
  }
}
