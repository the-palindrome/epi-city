export function createSignalUpdateSystem(city, clock) {
  return {
    update(deltaSeconds) {
      const signalDeltaSeconds = typeof clock?.toSimulationSeconds === 'function'
        ? clock.toSimulationSeconds(deltaSeconds)
        : deltaSeconds

      city.updateCrosswalkSignals(signalDeltaSeconds)
      city.updateTrafficSignals(signalDeltaSeconds)
    }
  }
}
