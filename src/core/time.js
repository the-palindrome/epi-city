export const HOURS_PER_DAY = 24

export function normalizeHour(hour) {
  return ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY
}

export function hourInRange(hour, startHour, endHour) {
  const normalized = normalizeHour(hour)

  if (startHour === endHour) {
    return true
  }

  if (startHour < endHour) {
    return normalized >= startHour && normalized < endHour
  }

  return normalized >= startHour || normalized < endHour
}
