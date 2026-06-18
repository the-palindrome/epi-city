import { describe, expect, it } from 'vitest'
import {
  CAR_CONFIG,
  INFECTION_CONFIG,
  NPC_CONFIG,
  SEIR_HEATMAP_CONFIG
} from './constants.js'
import {
  worldUnitsPerSecondToMetersPerSecond,
  worldUnitsPerSecondToMilesPerHour,
  worldUnitsToMeters
} from './scale.js'

describe('scale-derived simulation defaults', () => {
  it('uses plausible real-world pedestrian speeds', () => {
    expect(worldUnitsPerSecondToMetersPerSecond(NPC_CONFIG.minSpeed)).toBeCloseTo(1.1)
    expect(worldUnitsPerSecondToMetersPerSecond(NPC_CONFIG.maxSpeed)).toBeCloseTo(1.4)
    expect(NPC_CONFIG.movementTimeScale).toBe(4)
  })

  it('keeps pedestrian crowding defaults soft rather than hard-capping tiles', () => {
    expect(NPC_CONFIG.visualSlotCount).toBeGreaterThan(0)
    expect(NPC_CONFIG.crowding.softTileCapacity).toBeGreaterThan(0)
    expect(NPC_CONFIG.crowding.maxSpeedPenalty).toBeGreaterThan(0)
    expect(NPC_CONFIG.crowding.maxSpeedPenalty).toBeLessThan(1)
  })

  it('uses meter-derived infection and heatmap radii', () => {
    expect(worldUnitsToMeters(INFECTION_CONFIG.infectionDistance)).toBeCloseTo(2)
    expect(worldUnitsToMeters(INFECTION_CONFIG.infectionDistanceRange.max)).toBeCloseTo(25)
    expect(worldUnitsToMeters(INFECTION_CONFIG.infectionDistanceRange.step)).toBeCloseTo(1)
    expect(worldUnitsToMeters(SEIR_HEATMAP_CONFIG.radius)).toBeCloseTo(10)
    expect(worldUnitsToMeters(SEIR_HEATMAP_CONFIG.radiusRange.min)).toBeCloseTo(2)
    expect(worldUnitsToMeters(SEIR_HEATMAP_CONFIG.radiusRange.max)).toBeCloseTo(50)
  })

  it('interprets car speed limits as physical road speeds', () => {
    expect(CAR_CONFIG.speedLimitUnit).toBe('mph')
    expect(CAR_CONFIG.movementTimeScale).toBe(2)
    expect(worldUnitsPerSecondToMilesPerHour(CAR_CONFIG.maxSpeed)).toBeCloseTo(35)
    expect(worldUnitsToMeters(CAR_CONFIG.bodyWidth)).toBeCloseTo(1.85)
    expect(worldUnitsToMeters(CAR_CONFIG.roadBodyLength)).toBeCloseTo(3.45)
    expect(worldUnitsToMeters(CAR_CONFIG.longBodyLength)).toBeCloseTo(4.5)
  })
})
