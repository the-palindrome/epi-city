import { DEFAULT_BUILDING_TYPES } from '../core/constants.js'

export class CityBuilding {
  constructor({ id, types, entrance = null, spans }) {
    this.id = id
    this.types = Object.freeze([...types])
    this.entrance = entrance ? { ...entrance } : null
    this.spans = spans.map((span) => [...span])
  }
}

function normalizeBuildingTypeList(value, context) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} must be a non-empty array of type strings.`)
  }

  const types = []
  const seen = new Set()

  for (const rawType of value) {
    if (typeof rawType !== 'string' || rawType.length === 0) {
      throw new Error(`${context} must contain non-empty type strings.`)
    }

    if (!seen.has(rawType)) {
      seen.add(rawType)
      types.push(rawType)
    }
  }

  if (types.length === 0) {
    throw new Error(`${context} must include at least one type.`)
  }

  return Object.freeze(types)
}

export function normalizeBuildingTypes(building, context, fallbackTypes = DEFAULT_BUILDING_TYPES) {
  if (Object.prototype.hasOwnProperty.call(building, 'type')) {
    throw new Error(`${context}.type is no longer supported; use types instead.`)
  }

  if (Object.prototype.hasOwnProperty.call(building, 'types')) {
    return normalizeBuildingTypeList(building.types, `${context}.types`)
  }

  return Object.freeze([...fallbackTypes])
}

export function normalizeDefaultBuildingTypes(buildings) {
  if (Object.prototype.hasOwnProperty.call(buildings, 'defaultType')) {
    throw new Error('Map JSON buildings.defaultType is no longer supported; use defaultTypes instead.')
  }

  if (Object.prototype.hasOwnProperty.call(buildings, 'defaultTypes')) {
    return normalizeBuildingTypeList(buildings.defaultTypes, 'Map JSON buildings.defaultTypes')
  }

  return DEFAULT_BUILDING_TYPES
}

export function buildingHasAnyType(building, types) {
  if (!building || !Array.isArray(building.types)) {
    return false
  }

  const typeList = Array.isArray(types) ? types : [types]

  return typeList.some((type) => building.types.includes(type))
}

export function primaryBuildingType(building) {
  return building?.types?.[0] || null
}
