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
  minSpeed: 3.8,
  maxSpeed: 4.5,
  workStartHour: 9,
  workEndHour: 17,
  scheduleVariationHours: 0.75,
  routePlanBudget: 24,
  routeRetrySeconds: 1,
  routeBlockedReplanSeconds: 2
})

export const INFECTION_CONFIG = Object.freeze({
  initialInfectiousCount: 4,
  infectionDistance: 48,
  infectionProbability: 0.03,
  incubationDays: 5,
  infectionDays: 7,
  immunityDays: 90,
  colors: Object.freeze({
    susceptible: NPC_CONFIG.color,
    exposed: 0xf0a33a,
    infectious: 0xdb3b34,
    recovered: 0x49b86e
  }),
  initialInfectiousCountRange: Object.freeze({
    min: 0,
    max: 10000,
    step: 1
  }),
  infectionDistanceRange: Object.freeze({
    min: 0,
    max: 256,
    step: 1
  }),
  infectionProbabilityRange: Object.freeze({
    min: 0,
    max: 1,
    step: 0.01
  }),
  incubationDaysRange: Object.freeze({
    min: 0,
    max: 14,
    step: 0.25
  }),
  infectionDaysRange: Object.freeze({
    min: 0,
    max: 21,
    step: 0.25
  }),
  immunityDaysRange: Object.freeze({
    min: 0,
    max: 365,
    step: 1
  })
})

export const CAR_CONFIG = Object.freeze({
  count: 500,
  zorder: 1,
  colorPalette: Object.freeze([0x3f6fd8, 0xd94a48, 0xf1d15c, 0x55b86b, 0xd8dce6, 0x22272e]),
  twoTileChance: 0.82,
  maxOwners: 2,
  twoOwnerChance: 0.35,
  commuteChance: 0.65,
  workDepartureHour: 8,
  workDepartureEndHour: 10,
  homeDepartureHour: 17,
  homeDepartureEndHour: 20,
  maxSpeed: 72,
  speedLimitScale: 1.6,
  minCruiseSpeedScale: 0.72,
  maxCruiseSpeedScale: 0.96,
  minAdaptiveSpeedScale: 0.45,
  laneChangeSlowSpeedScale: 0.56,
  laneChangeOvertakeSpeedScale: 1,
  speedAdjustmentRate: 1.8,
  movingLaneChangeWaitSeconds: 0.7,
  parkingSearchRadius: 64,
  bodyWidth: 18,
  roadBodyLength: 34,
  longBodyLength: 44,
  parkedRoadOffset: 0.24
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
    max: 24,
    step: 0.25
  }),
  npcCountRange: Object.freeze({
    min: 100,
    max: 10000,
    step: 100
  }),
  carCountRange: Object.freeze({
    min: 0,
    max: 2000,
    step: 10
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
