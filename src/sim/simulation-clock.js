import { HOURS_PER_DAY, normalizeHour } from '../core/time.js'

const SECONDS_PER_HOUR = 3600

export class SimulationClock {
  constructor(options = {}) {
    this.secondsPerSimulationHour = positiveNumberOrDefault(options.secondsPerSimulationHour, 60)
    this.startHour = normalizeHour(numberOrDefault(options.startHour, 0))
    this.elapsedSimulationSeconds = 0
  }

  update(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    this.elapsedSimulationSeconds += this.toSimulationSeconds(deltaSeconds)
  }

  reset() {
    this.elapsedSimulationSeconds = 0
  }

  getElapsedSimulationSeconds() {
    return this.elapsedSimulationSeconds
  }

  getSimulationSecondsPerRealSecond() {
    return SECONDS_PER_HOUR / this.secondsPerSimulationHour
  }

  toSimulationSeconds(deltaSeconds) {
    return deltaSeconds * this.getSimulationSecondsPerRealSecond()
  }

  getTimeOfDayHours() {
    return normalizeHour(this.startHour + this.elapsedSimulationSeconds / SECONDS_PER_HOUR)
  }

  getDayIndex() {
    return Math.floor((this.startHour * SECONDS_PER_HOUR + this.elapsedSimulationSeconds) / (HOURS_PER_DAY * SECONDS_PER_HOUR))
  }

  getTimeOfDay() {
    const totalMinutes = Math.floor(this.getTimeOfDayHours() * 60)
    const hour = Math.floor(totalMinutes / 60) % HOURS_PER_DAY
    const minute = totalMinutes % 60

    return { hour, minute }
  }

  formatTimeOfDay() {
    const { hour, minute } = this.getTimeOfDay()

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
}

export function toSimulationSeconds(clock, deltaSeconds) {
  if (clock && typeof clock.toSimulationSeconds === 'function') {
    return clock.toSimulationSeconds(deltaSeconds)
  }

  if (clock && typeof clock.getSimulationSecondsPerRealSecond === 'function') {
    return deltaSeconds * clock.getSimulationSecondsPerRealSecond()
  }

  const secondsPerSimulationHour = Number(clock && clock.secondsPerSimulationHour)

  if (Number.isFinite(secondsPerSimulationHour) && secondsPerSimulationHour > 0) {
    return deltaSeconds * SECONDS_PER_HOUR / secondsPerSimulationHour
  }

  return deltaSeconds
}

function positiveNumberOrDefault(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : fallback
}

function numberOrDefault(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}
