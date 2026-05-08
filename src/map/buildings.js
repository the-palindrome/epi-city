import { DEFAULT_BUILDING_TYPES } from '../core/constants.js'

export class CityBuilding {
  constructor({ id, types, entrance = null, spans }) {
    this.id = id
    this.types = Object.freeze([...types])
    this.type = this.types[0]
    this.entrance = entrance ? { ...entrance } : null
    this.spans = spans.map((span) => [...span])
  }

  get primaryType() {
    return this.type
  }

  hasType(type) {
    return this.types.includes(type)
  }

  hasAnyType(types) {
    return types.some((type) => this.hasType(type))
  }
}

export function normalizeBuildingTypeList(value, context) {
  const rawTypes = Array.isArray(value) ? value : [value]
  const types = []
  const seen = new Set()

  for (const rawType of rawTypes) {
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
  if (Object.prototype.hasOwnProperty.call(building, 'types')) {
    return normalizeBuildingTypeList(building.types, `${context}.types`)
  }

  if (Object.prototype.hasOwnProperty.call(building, 'type')) {
    return normalizeBuildingTypeList(building.type, `${context}.type`)
  }

  return Object.freeze([...fallbackTypes])
}

export function normalizeDefaultBuildingTypes(buildings) {
  if (Object.prototype.hasOwnProperty.call(buildings, 'defaultTypes')) {
    return normalizeBuildingTypeList(buildings.defaultTypes, 'Map JSON buildings.defaultTypes')
  }

  if (Object.prototype.hasOwnProperty.call(buildings, 'defaultType')) {
    return normalizeBuildingTypeList(buildings.defaultType, 'Map JSON buildings.defaultType')
  }

  return DEFAULT_BUILDING_TYPES
}

export function buildingHasType(building, type) {
  return Boolean(building && typeof building.hasType === 'function'
    ? building.hasType(type)
    : buildingTypes(building).includes(type))
}

export function buildingHasAnyType(building, types) {
  const typeList = Array.isArray(types) ? types : [types]

  return Boolean(building && typeof building.hasAnyType === 'function'
    ? building.hasAnyType(typeList)
    : typeList.some((type) => buildingHasType(building, type)))
}

export function buildingTypes(building) {
  if (!building) {
    return []
  }

  if (Array.isArray(building.types)) {
    return building.types
  }

  return typeof building.type === 'string' && building.type.length > 0 ? [building.type] : []
}

export function primaryBuildingType(building) {
  return buildingTypes(building)[0] || null
}
