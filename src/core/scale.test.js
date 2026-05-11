import { describe, expect, it } from 'vitest'
import {
  METERS_PER_TILE,
  METERS_PER_WORLD_UNIT,
  REAL_WORLD_SCALE,
  WORLD_UNITS_PER_METER,
  WORLD_UNITS_PER_TILE,
  kilometersPerHourToMetersPerSecond,
  metersPerSecondToWorldUnitsPerSecond,
  metersToTiles,
  metersToWorldUnits,
  milesPerHourToMetersPerSecond,
  milesPerHourToWorldUnitsPerSecond,
  tilesToMeters,
  worldUnitsPerSecondToMilesPerHour,
  worldUnitsToMeters
} from './scale.js'

describe('real-world scale conversions', () => {
  it('defines 3.25 meters per 32-world-unit tile', () => {
    expect(METERS_PER_TILE).toBe(3.25)
    expect(WORLD_UNITS_PER_TILE).toBe(32)
    expect(METERS_PER_WORLD_UNIT).toBeCloseTo(0.1015625)
    expect(WORLD_UNITS_PER_METER).toBeCloseTo(9.846153846)
    expect(REAL_WORLD_SCALE).toEqual({
      metersPerTile: METERS_PER_TILE,
      worldUnitsPerTile: WORLD_UNITS_PER_TILE,
      metersPerWorldUnit: METERS_PER_WORLD_UNIT,
      worldUnitsPerMeter: WORLD_UNITS_PER_METER
    })
  })

  it('converts distances between meters, tiles, and world units', () => {
    expect(tilesToMeters(256)).toBe(832)
    expect(metersToTiles(832)).toBe(256)
    expect(metersToWorldUnits(3.25)).toBe(32)
    expect(worldUnitsToMeters(32)).toBe(3.25)
  })

  it('converts walking and vehicle speeds into world units per second', () => {
    expect(metersPerSecondToWorldUnitsPerSecond(1.4)).toBeCloseTo(13.784615)
    expect(kilometersPerHourToMetersPerSecond(36)).toBeCloseTo(10)
    expect(milesPerHourToMetersPerSecond(35)).toBeCloseTo(15.6464)
    expect(milesPerHourToWorldUnitsPerSecond(35)).toBeCloseTo(154.056862)
    expect(worldUnitsPerSecondToMilesPerHour(milesPerHourToWorldUnitsPerSecond(28))).toBeCloseTo(28)
  })
})
