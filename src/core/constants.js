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
  minSpeed: 1.9,
  maxSpeed: 2.25,
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
  incubationDays: 1,
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
  maxSpeed: 18,
  speedLimitScale: 0.4,
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

export const SEIR_HEATMAP_CONFIG = Object.freeze({
  radius: 96,
  radiusRange: Object.freeze({
    min: 16,
    max: 512,
    step: 16
  }),
  alpha: 0.72,
  minimumNormalizedDensity: 0.02,
  zorder: 2.5,
  states: Object.freeze([
    Object.freeze({
      id: 'heatmapSusceptible',
      label: 'S heatmap',
      infection: 'susceptible',
      color: INFECTION_CONFIG.colors.susceptible
    }),
    Object.freeze({
      id: 'heatmapExposed',
      label: 'E heatmap',
      infection: 'exposed',
      color: INFECTION_CONFIG.colors.exposed
    }),
    Object.freeze({
      id: 'heatmapInfectious',
      label: 'I heatmap',
      infection: 'infectious',
      color: INFECTION_CONFIG.colors.infectious
    }),
    Object.freeze({
      id: 'heatmapRecovered',
      label: 'R heatmap',
      infection: 'recovered',
      color: INFECTION_CONFIG.colors.recovered
    })
  ])
})

export const ENTITY_RENDER_MODE_ID = 'sprite'

export const ENTITY_RENDER_MODES = Object.freeze({
  sprite: Object.freeze({ id: 'sprite', label: 'sprite' }),
  geometric: Object.freeze({ id: 'geometric', label: 'geometric' })
})

export const ENTITY_RENDER_MODE_OPTIONS = Object.freeze([
  ENTITY_RENDER_MODES.sprite,
  ENTITY_RENDER_MODES.geometric
])

export const ENTITY_RENDER_DEBUG_CONFIG = Object.freeze({
  infectionRadiusVisible: false,
  infectionEdgesVisible: false,
  contactEdgesVisible: false,
  infectionEdgeDurationMinutes: 10,
  contactEdgeDurationMinutes: 10,
  infectionEdgeDurationRange: Object.freeze({
    min: 1,
    max: 120,
    step: 1
  }),
  contactEdgeDurationRange: Object.freeze({
    min: 1,
    max: 120,
    step: 1
  }),
  pathTrailsVisible: false,
  pathTrailLength: 5,
  pathTrailLengthRange: Object.freeze({
    min: 1,
    max: 100,
    step: 1
  })
})

export const DASHBOARD_OVERLAYS = Object.freeze([
  Object.freeze({ id: 'tileType', label: 'tile overlay', kind: 'tileType' }),
  ...SEIR_HEATMAP_CONFIG.states.map((state) => Object.freeze({
    id: state.id,
    label: state.label,
    kind: 'heatmap',
    infection: state.infection,
    color: state.color
  }))
])

export const TILE_TYPE_OVERLAY_SCHEME_ID = 'tileType'

export const TILE_TYPE_OVERLAY_COLOR_SCHEMES = Object.freeze({
  tileType: Object.freeze({
    label: 'tile type',
    sidewalk: 0xffffff,
    road: 0x151a16,
    park: 0x59a14f,
    water: 0x2f80d0,
    building: Object.freeze({
      residential: 0x3f6fa7,
      commercial: 0xe09b2d,
      default: 0x8c8f94
    }),
    obstacle: 0xd1495b,
    crosswalk: 0xb8beb9,
    crosswalkStripe: 0xffffff
  }),
  'monochrome-light': Object.freeze({
    label: 'monochrome-light',
    sidewalk: 0xffffff,
    road: 0xd3d6d2,
    park: 0xf2f3f1,
    water: 0xe5e8ea,
    building: Object.freeze({
      residential: 0xa8ada7,
      commercial: 0x8f9690,
      default: 0xb7bcb6
    }),
    obstacle: 0xaeb4ae,
    crosswalk: 0xd3d6d2,
    crosswalkStripe: 0xffffff
  }),
  'monochrome-dark': Object.freeze({
    label: 'monochrome-dark',
    sidewalk: 0x5f6661,
    road: 0x141816,
    park: 0x343a36,
    water: 0x292f31,
    building: Object.freeze({
      residential: 0x6f7871,
      commercial: 0x838c84,
      default: 0x606861
    }),
    obstacle: 0x202522,
    crosswalk: 0x141816,
    crosswalkStripe: 0x818982
  })
})

export const TILE_TYPE_OVERLAY_SCHEME_OPTIONS = Object.freeze([
  Object.freeze({ id: 'tileType', label: TILE_TYPE_OVERLAY_COLOR_SCHEMES.tileType.label }),
  Object.freeze({ id: 'monochrome-light', label: TILE_TYPE_OVERLAY_COLOR_SCHEMES['monochrome-light'].label }),
  Object.freeze({ id: 'monochrome-dark', label: TILE_TYPE_OVERLAY_COLOR_SCHEMES['monochrome-dark'].label })
])

export const TILE_TYPE_OVERLAY_COLORS = Object.freeze({
  sidewalk: 0xffffff,
  road: 0x151a16,
  park: 0x59a14f,
  water: 0x2f80d0,
  building: Object.freeze({
    residential: 0x3f6fa7,
    commercial: 0xe09b2d,
    default: 0x8c8f94
  }),
  obstacle: 0xd1495b,
  crosswalk: 0xb8beb9,
  crosswalkStripe: 0xffffff,
  alpha: 0.78,
  opacityRange: Object.freeze({
    min: 0,
    max: 1,
    step: 0.05
  })
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
