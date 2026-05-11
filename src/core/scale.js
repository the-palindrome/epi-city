export const WORLD_UNITS_PER_TILE = 32
export const METERS_PER_TILE = 3.25
export const METERS_PER_WORLD_UNIT = METERS_PER_TILE / WORLD_UNITS_PER_TILE
export const WORLD_UNITS_PER_METER = WORLD_UNITS_PER_TILE / METERS_PER_TILE

const METERS_PER_KILOMETER = 1000
const SECONDS_PER_HOUR = 3600
const KILOMETERS_PER_MILE = 1.609344

export const REAL_WORLD_SCALE = Object.freeze({
  metersPerTile: METERS_PER_TILE,
  worldUnitsPerTile: WORLD_UNITS_PER_TILE,
  metersPerWorldUnit: METERS_PER_WORLD_UNIT,
  worldUnitsPerMeter: WORLD_UNITS_PER_METER
})

export function metersToWorldUnits(meters) {
  return Number(meters) * WORLD_UNITS_PER_METER
}

export function worldUnitsToMeters(worldUnits) {
  return Number(worldUnits) * METERS_PER_WORLD_UNIT
}

export function tilesToMeters(tiles) {
  return Number(tiles) * METERS_PER_TILE
}

export function metersToTiles(meters) {
  return Number(meters) / METERS_PER_TILE
}

export function metersPerSecondToWorldUnitsPerSecond(metersPerSecond) {
  return metersToWorldUnits(metersPerSecond)
}

export function worldUnitsPerSecondToMetersPerSecond(worldUnitsPerSecond) {
  return worldUnitsToMeters(worldUnitsPerSecond)
}

export function kilometersPerHourToMetersPerSecond(kilometersPerHour) {
  return Number(kilometersPerHour) * METERS_PER_KILOMETER / SECONDS_PER_HOUR
}

export function kilometersPerHourToWorldUnitsPerSecond(kilometersPerHour) {
  return metersPerSecondToWorldUnitsPerSecond(
    kilometersPerHourToMetersPerSecond(kilometersPerHour)
  )
}

export function milesPerHourToMetersPerSecond(milesPerHour) {
  return kilometersPerHourToMetersPerSecond(Number(milesPerHour) * KILOMETERS_PER_MILE)
}

export function milesPerHourToWorldUnitsPerSecond(milesPerHour) {
  return metersPerSecondToWorldUnitsPerSecond(milesPerHourToMetersPerSecond(milesPerHour))
}

export function worldUnitsPerSecondToKilometersPerHour(worldUnitsPerSecond) {
  return worldUnitsPerSecondToMetersPerSecond(worldUnitsPerSecond) * SECONDS_PER_HOUR / METERS_PER_KILOMETER
}

export function worldUnitsPerSecondToMilesPerHour(worldUnitsPerSecond) {
  return worldUnitsPerSecondToKilometersPerHour(worldUnitsPerSecond) / KILOMETERS_PER_MILE
}
