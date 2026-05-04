const TILE_TYPES = Object.freeze({
  road: 0,
  sidewalk: 1,
  park: 2,
  water: 3,
  building: 4,
  obstacle: 5,
  crosswalk: 6
})

export const TILE_NAMES = Object.freeze([
  'road',
  'sidewalk',
  'park',
  'water',
  'building',
  'obstacle',
  'crosswalk'
])

export const CATEGORY_TO_TILE = Object.freeze({
  road: TILE_TYPES.road,
  sidewalk: TILE_TYPES.sidewalk,
  park: TILE_TYPES.park,
  water: TILE_TYPES.water,
  building: TILE_TYPES.building,
  obstacle: TILE_TYPES.obstacle,
  crosswalk: TILE_TYPES.crosswalk
})

export const CROSSWALK_SIGNAL_PHASES = Object.freeze([
  Object.freeze({ state: 'red', duration: 4 }),
  Object.freeze({ state: 'green', duration: 6 }),
  Object.freeze({ state: 'yellow', duration: 2 })
])

export const TEXTURE_SET_PATHS = Object.freeze({
  'liberty-city': './maps/liberty-city/manifest.json'
})

export const DEFAULT_CITY_MAP_PATHS = Object.freeze({
  tileLayout: './maps/liberty-city/tile-layout.json',
  textureLayout: './maps/liberty-city/texture-layout.json'
})

export const BUILDING_LAYOUT_ENCODING = 'row-spans-v1'
export const DEFAULT_BUILDING_TYPE = 'residential'
export const PIXEL_ART_SCALE_MODE = 'nearest'

export const MOVEMENT_PROPERTY_BY_MODE = Object.freeze({
  pedestrian: 'walkable',
  vehicle: 'drivable'
})

export const NPC_CONFIG = Object.freeze({
  count: 1000,
  zorder: 1,
  tileCapacity: 9,
  maxVisiblePerTile: 9,
  slotSpacing: 11,
  color: 0xe5c748,
  size: 9,
  minSpeed: 34,
  maxSpeed: 58,
  workStartHour: 9,
  workEndHour: 17,
  scheduleVariationHours: 0.75,
  routePlanBudget: 24,
  routeRetrySeconds: 1,
  routeBlockedReplanSeconds: 2,
  routeVariationChance: 0.35,
  routeVariationSlack: 20
})

export const SIMULATION_CONFIG = Object.freeze({
  seedEnabled: true,
  seed: 'epi-city',
  speed: 1,
  dayNightOverlayEnabled: true,
  clock: Object.freeze({
    startHour: 8,
    secondsPerSimulationHour: 60
  }),
  speedRange: Object.freeze({
    min: 1,
    max: 16,
    step: 0.25
  }),
  npcCountRange: Object.freeze({
    min: 100,
    max: 10000,
    step: 100
  })
})

export const TILE_ZORDERS = Object.freeze({
  default: 0,
  building: 2
})

export const DASHBOARD_OVERLAYS = Object.freeze([
  { id: 'tileType', label: 'overlay tile type', kind: 'tileType' },
  { id: 'walkable', label: 'overlay walkable', layer: 'tileWalkable' },
  { id: 'parkable', label: 'overlay parkable', layer: 'tileParkable' },
  { id: 'drivable', label: 'overlay drivable', layer: 'tileDrivable' }
])

export const DEBUG_OVERLAY_COLORS = Object.freeze({
  enabled: 0x35d46f,
  disabled: 0xe3504f,
  enabledAlpha: 0.42,
  disabledAlpha: 0.34
})

export const TILE_TYPE_OVERLAY_COLORS = Object.freeze({
  sidewalk: 0x9aa09a,
  road: 0x151a16,
  park: 0x4fa43d,
  water: 0x0786c8,
  building: 0x5f6762,
  obstacle: 0xd94a48,
  crosswalk: 0x151a16,
  crosswalkStripe: 0xffffff,
  alpha: 0.86
})

export const DIRECTIONS = Object.freeze([
  { dx: 1, dy: 0, cost: 10 },
  { dx: -1, dy: 0, cost: 10 },
  { dx: 0, dy: 1, cost: 10 },
  { dx: 0, dy: -1, cost: 10 },
  { dx: 1, dy: 1, cost: 14 },
  { dx: 1, dy: -1, cost: 14 },
  { dx: -1, dy: 1, cost: 14 },
  { dx: -1, dy: -1, cost: 14 }
])
