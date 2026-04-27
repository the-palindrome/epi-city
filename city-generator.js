/**
 * Standalone procedural city map generator.
 *
 * The generator builds semantic layers first, then rasterizes them to the
 * existing compact map JSON tile schema: r/s/h/c/w/b/p.
 */

const LEGEND = Object.freeze({
  r: 'road',
  s: 'sidewalk',
  h: 'residential',
  c: 'commercial',
  w: 'water',
  b: 'bridge',
  p: 'park'
});

const TILE_SYMBOLS = Object.freeze({
  road: 'r',
  sidewalk: 's',
  residential: 'h',
  commercial: 'c',
  water: 'w',
  bridge: 'b',
  park: 'p'
});

const WATER = 1;
const LAND = 0;

/**
 * @typedef {Object} CityGeneratorConfig
 * @property {number=} width Tile grid width. Defaults to 256.
 * @property {number=} height Tile grid height. Defaults to 256.
 * @property {number=} tileSize World-space tile size. Defaults to 32.
 * @property {number|string=} seed Seed used for deterministic generation.
 * @property {number=} maxRetries Validation attempts before returning the best effort error.
 * @property {number=} edgeBand Non-passable building border width.
 * @property {number=} waterCoverageTarget Approximate fraction of map covered by water.
 * @property {number=} arterialSpacing Approximate spacing between major roads.
 * @property {number=} collectorSpacing Approximate spacing between secondary roads.
 * @property {number=} localRoadChance Chance to add short local streets inside large land masses.
 * @property {number=} bridgeChance Random priority boost for eligible road-water crossings.
 * @property {number=} maxWaterBridges Maximum number of water-crossing bridge corridors.
 * @property {number=} minBridgeDistance Minimum tile distance between water bridge corridors.
 * @property {number=} parkChance Chance for eligible blocks to become parks.
 * @property {number=} landmarkCount Number of landmark anchors to place.
 */

/**
 * @typedef {Object} Rect
 * @property {number} x Left tile.
 * @property {number} y Top tile.
 * @property {number} width Width in tiles.
 * @property {number} height Height in tiles.
 */

/**
 * @typedef {Object} District
 * @property {number} id Stable district id.
 * @property {'downtown'|'residential'|'commercial'|'park'|'waterfront'} type District role.
 * @property {Rect} bounds District bounding box.
 * @property {{x:number,y:number}} center District center tile.
 */

/**
 * @typedef {Object} RoadSegment
 * @property {number} id Stable road segment id.
 * @property {'arterial'|'collector'|'local'} hierarchy Road hierarchy.
 * @property {'horizontal'|'vertical'} orientation Segment orientation.
 * @property {number} x1 Start x.
 * @property {number} y1 Start y.
 * @property {number} x2 End x.
 * @property {number} y2 End y.
 */

/**
 * @typedef {Object} Bridge
 * @property {number} id Stable bridge id.
 * @property {Rect} bounds Bridge tile bounds.
 * @property {'horizontal'|'vertical'} orientation Bridge orientation.
 */

/**
 * @typedef {Object} Block
 * @property {number} id Stable block id.
 * @property {Rect} bounds Block bounds.
 * @property {number} area Number of land tiles in the block.
 * @property {number[]} cells Flattened tile indexes in this block.
 * @property {number|null} districtId Owning district id when known.
 */

/**
 * @typedef {Object} Parcel
 * @property {number} id Stable parcel id.
 * @property {number} blockId Parent block id.
 * @property {Rect} bounds Parcel bounds.
 * @property {'residential'|'commercial'|'park'|'civic'} use Parcel use.
 */

/**
 * @typedef {Object} Building
 * @property {number} id Stable building id.
 * @property {number} parcelId Parent parcel id.
 * @property {Rect} footprint Building footprint.
 * @property {number} floors Floor count.
 * @property {'residential'|'commercial'|'civic'} use Building use.
 */

/**
 * @typedef {Object} Landmark
 * @property {number} id Stable landmark id.
 * @property {string} name Landmark name.
 * @property {'station'|'plaza'|'tower'|'stadium'|'harbor'} type Landmark type.
 * @property {Rect} bounds Landmark bounds.
 */

/**
 * @typedef {Object} GameplayPoint
 * @property {number} id Stable gameplay point id.
 * @property {'spawn'|'objective'|'service'|'viewpoint'} type Gameplay point role.
 * @property {number} x Tile x.
 * @property {number} y Tile y.
 */

/**
 * @typedef {Object} CityTiles
 * @property {1} schemaVersion Schema version expected by the app.
 * @property {number} width Tile grid width.
 * @property {number} height Tile grid height.
 * @property {number} tileSize World-space tile size.
 * @property {{r:string,s:string,h:string,c:string,w:string,b:string,p:string}} legend Symbol legend.
 * @property {string[]} rows Tile rows.
 */

/**
 * @typedef {Object} GeneratedCity
 * @property {CityGeneratorConfig} config Resolved config.
 * @property {{terrain:Uint8Array,districts:Int16Array,roads:Uint8Array,bridges:Uint8Array,blocks:Int32Array,parcels:Int32Array,buildings:Int32Array,landmarks:Int16Array,gameplay:Int16Array}} layers Semantic raster layers.
 * @property {{districts:District[],roads:RoadSegment[],bridges:Bridge[],blocks:Block[],parcels:Parcel[],buildings:Building[],landmarks:Landmark[],gameplay:GameplayPoint[]}} semantics Semantic object layers.
 * @property {CityTiles} tiles Rasterized map JSON payload.
 * @property {{attempts:number,valid:boolean,warnings:string[]}} validation Validation summary.
 */

/** @type {Required<CityGeneratorConfig>} */
const defaultCityGeneratorConfig = Object.freeze({
  width: 256,
  height: 256,
  tileSize: 32,
  seed: 'epi-city',
  maxRetries: 5,
  edgeBand: 6,
  waterCoverageTarget: 0.14,
  arterialSpacing: 42,
  collectorSpacing: 24,
  localRoadChance: 0.32,
  bridgeChance: 0.34,
  maxWaterBridges: 6,
  minBridgeDistance: 18,
  parkChance: 0.11,
  landmarkCount: 7
});

class SeededRandom {
  /** @param {number|string} seed */
  constructor(seed) {
    this.state = hashSeed(seed);
  }

  /** @returns {number} */
  next() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @param {number} min @param {number} max @returns {number} */
  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** @template T @param {T[]} values @returns {T} */
  pick(values) {
    return values[this.int(0, values.length - 1)];
  }

  /** @param {number} chance @returns {boolean} */
  chance(chance) {
    return this.next() < chance;
  }
}

class CityMapGenerator {
  /**
   * Generate a complete semantic city and matching tile rows.
   *
   * @param {CityGeneratorConfig=} config
   * @returns {GeneratedCity}
   */
  static generate(config) {
    return generate(config);
  }

  /**
   * Create a reusable generator with default overrides.
   *
   * @param {CityGeneratorConfig=} defaults
   */
  constructor(defaults) {
    this.defaults = resolveConfig(defaults || {});
  }

  /**
   * Generate with constructor defaults plus per-call overrides.
   *
   * @param {CityGeneratorConfig=} config
   * @returns {GeneratedCity}
   */
  generate(config) {
    return generate(Object.assign({}, this.defaults, config || {}));
  }
}

/**
 * Generate a complete semantic city and matching tile rows.
 *
 * @param {CityGeneratorConfig=} inputConfig
 * @returns {GeneratedCity}
 */
function generate(inputConfig) {
  const baseConfig = resolveConfig(inputConfig || {});
  let lastError = null;

  for (let attempt = 0; attempt < baseConfig.maxRetries; attempt += 1) {
    const config = Object.assign({}, baseConfig, {
      seed: attempt === 0 ? baseConfig.seed : `${baseConfig.seed}:${attempt}`
    });
    const rng = new SeededRandom(config.seed);

    try {
      const city = buildCity(config, rng, attempt + 1);
      const warnings = validateGeneratedCity(city);
      city.validation.valid = warnings.length === 0;
      city.validation.warnings = warnings;

      if (city.validation.valid || attempt === baseConfig.maxRetries - 1) {
        return city;
      }

      lastError = new Error(warnings.join('; '));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('City generation failed.');
}

/**
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @param {number} attempts
 * @returns {GeneratedCity}
 */
function buildCity(config, rng, attempts) {
  const width = config.width;
  const height = config.height;
  const length = width * height;
  const terrain = new Uint8Array(length);
  const districtLayer = fillInt16(length, -1);
  const roadLayer = new Uint8Array(length);
  const bridgeLayer = new Uint8Array(length);
  const blockLayer = fillInt32(length, -1);
  const parcelLayer = fillInt32(length, -1);
  const buildingLayer = fillInt32(length, -1);
  const landmarkLayer = fillInt16(length, -1);
  const gameplayLayer = fillInt16(length, -1);

  carveWater(terrain, width, height, config, rng);
  const districts = createDistricts(districtLayer, terrain, width, height, rng);
  const roadSegments = createRoads(roadLayer, terrain, width, height, config, rng);
  const bridges = createBridges(roadLayer, bridgeLayer, terrain, width, height, config, rng);
  trimUnbridgedWaterRoadEnds(roadLayer, bridgeLayer, terrain, width, height);
  addSideAccessRoads(roadLayer, terrain, bridgeLayer, width, height, config, rng);
  collapseNarrowRoadGaps(roadLayer, bridgeLayer, terrain, width, height);
  bridges.push(...connectRoadNetwork(roadLayer, bridgeLayer, terrain, width, height, bridges.length));
  trimUnbridgedWaterRoadEnds(roadLayer, bridgeLayer, terrain, width, height);
  addPedestrianCrossings(roadLayer, bridgeLayer, terrain, width, height);
  collapseNarrowRoadGaps(roadLayer, bridgeLayer, terrain, width, height);
  pruneTinyRoadComponents(roadLayer, bridgeLayer, width, height, 12);
  const blocks = extractBlocks(blockLayer, terrain, roadLayer, bridgeLayer, districtLayer, width, height);
  const parcels = createParcels(parcelLayer, blocks, districtLayer, terrain, roadLayer, width, height, config, rng);
  const buildings = createBuildings(buildingLayer, parcels, terrain, roadLayer, bridgeLayer, width, height, rng);
  const landmarks = createLandmarks(landmarkLayer, parcels, buildings, terrain, roadLayer, width, height, config, rng);
  const gameplay = createGameplay(gameplayLayer, roadLayer, bridgeLayer, terrain, landmarkLayer, width, height, rng);
  const tiles = rasterizeTiles({
    width,
    height,
    tileSize: config.tileSize,
    edgeBand: config.edgeBand,
    terrain,
    districtLayer,
    roadLayer,
    bridgeLayer,
    parcelLayer,
    buildingLayer,
    landmarkLayer,
    districts,
    parcels
  });

  return {
    config,
    layers: {
      terrain,
      districts: districtLayer,
      roads: roadLayer,
      bridges: bridgeLayer,
      blocks: blockLayer,
      parcels: parcelLayer,
      buildings: buildingLayer,
      landmarks: landmarkLayer,
      gameplay: gameplayLayer
    },
    semantics: {
      districts,
      roads: roadSegments,
      bridges,
      blocks,
      parcels,
      buildings,
      landmarks,
      gameplay
    },
    tiles,
    validation: {
      attempts,
      valid: false,
      warnings: []
    }
  };
}

/** @param {CityGeneratorConfig} input @returns {Required<CityGeneratorConfig>} */
function resolveConfig(input) {
  const config = Object.assign({}, defaultCityGeneratorConfig, input || {});
  config.width = clampInteger(config.width, 32, 1024, defaultCityGeneratorConfig.width);
  config.height = clampInteger(config.height, 32, 1024, defaultCityGeneratorConfig.height);
  config.tileSize = clampInteger(config.tileSize, 1, 512, defaultCityGeneratorConfig.tileSize);
  config.maxRetries = clampInteger(config.maxRetries, 1, 20, defaultCityGeneratorConfig.maxRetries);
  config.edgeBand = clampInteger(config.edgeBand, 0, Math.floor(Math.min(config.width, config.height) / 4), defaultCityGeneratorConfig.edgeBand);
  config.waterCoverageTarget = clampNumber(config.waterCoverageTarget, 0.04, 0.34, defaultCityGeneratorConfig.waterCoverageTarget);
  config.arterialSpacing = clampInteger(config.arterialSpacing, 12, Math.max(12, Math.min(config.width, config.height)), defaultCityGeneratorConfig.arterialSpacing);
  config.collectorSpacing = clampInteger(config.collectorSpacing, 8, Math.max(8, Math.min(config.width, config.height)), defaultCityGeneratorConfig.collectorSpacing);
  config.localRoadChance = clampNumber(config.localRoadChance, 0, 1, defaultCityGeneratorConfig.localRoadChance);
  config.bridgeChance = clampNumber(config.bridgeChance, 0.1, 0.9, defaultCityGeneratorConfig.bridgeChance);
  config.maxWaterBridges = clampInteger(config.maxWaterBridges, 1, 16, defaultCityGeneratorConfig.maxWaterBridges);
  config.minBridgeDistance = clampInteger(config.minBridgeDistance, 0, Math.max(config.width, config.height), defaultCityGeneratorConfig.minBridgeDistance);
  config.parkChance = clampNumber(config.parkChance, 0, 0.6, defaultCityGeneratorConfig.parkChance);
  config.landmarkCount = clampInteger(config.landmarkCount, 0, 48, defaultCityGeneratorConfig.landmarkCount);
  return config;
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 */
function carveWater(terrain, width, height, config, rng) {
  const target = Math.floor(width * height * config.waterCoverageTarget);
  const minSize = Math.min(width, height);
  const recipe = rng.pick(['bentCanal', 'harborAndCanal', 'parallelCuts', 'brokenArchipelago', 'crossCut']);
  const baseRadius = Math.max(2, Math.floor(minSize / rng.int(34, 48)));
  const channelCount = recipe === 'parallelCuts' ? rng.int(2, 3) : rng.int(1, 3);

  if (recipe === 'harborAndCanal') {
    carveEdgeHarbor(terrain, width, height, rng);
  }

  if (recipe === 'brokenArchipelago') {
    carveLagoonCluster(terrain, width, height, rng, rng.int(3, 5));
  }

  for (let i = 0; i < channelCount; i += 1) {
    const radius = baseRadius + rng.int(0, Math.max(1, Math.floor(minSize / 96)));
    const endpoints = chooseWaterChannelEndpoints(width, height, recipe, i, rng);
    const controlPoints = buildWaterControlPoints(width, height, endpoints.start, endpoints.end, recipe, rng);
    paintChunkyChannel(terrain, width, height, controlPoints, radius, rng);

    if (rng.chance(0.45)) {
      const branchStart = controlPoints[rng.int(1, Math.max(1, controlPoints.length - 2))];
      const branchEnd = sampleEdgePoint(width, height, rng.pick(['top', 'right', 'bottom', 'left']), rng);
      const branchPoints = buildWaterControlPoints(width, height, branchStart, branchEnd, 'branch', rng);
      paintChunkyChannel(terrain, width, height, branchPoints, Math.max(2, radius - rng.int(0, 2)), rng);
    }
  }

  if (recipe !== 'harborAndCanal' && rng.chance(0.55)) {
    carveEdgeHarbor(terrain, width, height, rng);
  }

  if (rng.chance(0.65)) {
    carveLagoonCluster(terrain, width, height, rng, rng.int(1, 3));
  }

  let waterCount = countValue(terrain, WATER);
  let safety = 0;
  while (waterCount < target && safety < 256) {
    safety += 1;
    const cx = rng.int(0, width - 1);
    const cy = rng.int(0, height - 1);
    const rx = rng.int(Math.max(2, Math.floor(width / 42)), Math.max(4, Math.floor(width / 18)));
    const ry = rng.int(Math.max(2, Math.floor(height / 42)), Math.max(4, Math.floor(height / 18)));
    paintEllipse(terrain, width, height, cx, cy, rx, ry, WATER);
    waterCount = countValue(terrain, WATER);
  }
}

/**
 * @param {Int16Array} districtLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {SeededRandom} rng
 * @returns {District[]}
 */
function createDistricts(districtLayer, terrain, width, height, rng) {
  const districts = [];
  const cols = Math.max(3, Math.round(width / 64));
  const rows = Math.max(3, Math.round(height / 64));
  const cellW = Math.ceil(width / cols);
  const cellH = Math.ceil(height / rows);
  const centerX = width / 2;
  const centerY = height / 2;

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const x = gx * cellW;
      const y = gy * cellH;
      const bounds = {
        x,
        y,
        width: Math.min(cellW, width - x),
        height: Math.min(cellH, height - y)
      };
      const districtCenter = {
        x: x + Math.floor(bounds.width / 2),
        y: y + Math.floor(bounds.height / 2)
      };
      const distToCenter = distance(districtCenter.x, districtCenter.y, centerX, centerY) / Math.max(width, height);
      const waterNear = hasWaterNear(terrain, width, height, districtCenter.x, districtCenter.y, Math.floor(Math.min(width, height) / 10));
      let type = 'residential';

      if (distToCenter < 0.18) type = 'downtown';
      else if (waterNear && rng.chance(0.42)) type = 'waterfront';
      else if (rng.chance(0.16)) type = 'commercial';
      else if (rng.chance(0.12)) type = 'park';

      const district = {
        id: districts.length,
        type,
        bounds,
        center: districtCenter
      };
      districts.push(district);

      forEachRect(bounds, width, height, (xx, yy, index) => {
        if (terrain[index] !== WATER) districtLayer[index] = district.id;
      });
    }
  }

  return districts;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @returns {RoadSegment[]}
 */
function createRoads(roadLayer, terrain, width, height, config, rng) {
  const roads = [];
  const margin = Math.max(config.edgeBand + 2, Math.floor(Math.min(width, height) / 48));
  const arterialSpacing = Math.min(config.arterialSpacing, Math.max(12, Math.floor(Math.min(width, height) / 2)));
  const collectorSpacing = Math.min(config.collectorSpacing, Math.max(8, Math.floor(Math.min(width, height) / 3)));
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const xs = uniqueSorted([
    margin,
    width - margin - 1,
    centerX,
    ...jitteredLines(margin + arterialSpacing, width - margin, arterialSpacing, rng, 4)
  ]);
  const ys = uniqueSorted([
    margin,
    height - margin - 1,
    centerY,
    ...jitteredLines(margin + arterialSpacing, height - margin, arterialSpacing, rng, 4)
  ]);

  for (const x of xs) {
    roads.push(drawRoadLine(roadLayer, width, height, x, margin, x, height - margin - 1, 'vertical', 'arterial'));
  }
  for (const y of ys) {
    roads.push(drawRoadLine(roadLayer, width, height, margin, y, width - margin - 1, y, 'horizontal', 'arterial'));
  }

  for (const x of jitteredLines(margin + collectorSpacing, width - margin, collectorSpacing, rng, 3)) {
    if (!nearAny(x, xs, Math.max(5, Math.floor(collectorSpacing / 3)))) {
      roads.push(...drawSegmentedRoadLine(roadLayer, width, height, x, margin, x, height - margin - 1, 'vertical', 'collector', rng));
    }
  }
  for (const y of jitteredLines(margin + collectorSpacing, height - margin, collectorSpacing, rng, 3)) {
    if (!nearAny(y, ys, Math.max(5, Math.floor(collectorSpacing / 3)))) {
      roads.push(...drawSegmentedRoadLine(roadLayer, width, height, margin, y, width - margin - 1, y, 'horizontal', 'collector', rng));
    }
  }

  const localSpacing = Math.max(10, Math.floor(collectorSpacing * 0.65));
  for (let y = margin + localSpacing; y < height - margin; y += localSpacing) {
    if (rng.chance(config.localRoadChance)) {
      const start = rng.int(margin, Math.max(margin, Math.floor(width * 0.25)));
      const end = rng.int(Math.min(width - margin - 1, Math.floor(width * 0.75)), width - margin - 1);
      roads.push(drawRoadLine(roadLayer, width, height, start, y + rng.int(-2, 2), end, y + rng.int(-2, 2), 'horizontal', 'local'));
    }
  }
  for (let x = margin + localSpacing; x < width - margin; x += localSpacing) {
    if (rng.chance(config.localRoadChance * 0.75)) {
      const start = rng.int(margin, Math.max(margin, Math.floor(height * 0.25)));
      const end = rng.int(Math.min(height - margin - 1, Math.floor(height * 0.75)), height - margin - 1);
      roads.push(drawRoadLine(roadLayer, width, height, x + rng.int(-2, 2), start, x + rng.int(-2, 2), end, 'vertical', 'local'));
    }
  }

  return roads.filter(Boolean).map((road, id) => Object.assign(road, { id }));
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @returns {Bridge[]}
 */
function createBridges(roadLayer, bridgeLayer, terrain, width, height, config, rng) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = toIndex(x, y, width);
      if (visited[index] || roadLayer[index] === 0 || terrain[index] !== WATER) continue;

      const cells = collectRoadWaterComponent(roadLayer, terrain, width, height, x, y, visited);
      if (cells.length === 0) continue;

      components.push(createBridgeCandidate(roadLayer, terrain, width, height, cells, config, rng, components.length));
    }
  }

  const eligible = components
    .filter((component) => component.eligible)
    .sort((a, b) => b.score - a.score);
  const selected = [];
  const selectedIds = new Set();

  for (const candidate of eligible) {
    if (selected.length >= config.maxWaterBridges) break;
    if (!isFarEnoughFromSelectedBridges(candidate, selected, config.minBridgeDistance)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  if (selected.length === 0 && eligible.length > 0) {
    selected.push(eligible[0]);
    selectedIds.add(eligible[0].id);
  }

  const bridges = [];
  for (const component of components) {
    if (!selectedIds.has(component.id)) {
      for (const cell of component.cells) roadLayer[cell] = 0;
      trimRejectedBridgeApproaches(roadLayer, terrain, width, height, component);
      continue;
    }

    reinforceBridgeApproaches(roadLayer, terrain, width, height, component);
    const bridge = normalizeBridgeCandidateWidth(component, terrain, width, height);
    for (const cell of bridge.cells) bridgeLayer[cell] = 1;
    bridges.push({
      id: bridges.length,
      bounds: bridge.bounds,
      orientation: bridge.orientation
    });
  }

  return bridges;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 */
function addSideAccessRoads(roadLayer, terrain, bridgeLayer, width, height, config, rng) {
  const stride = Math.max(12, Math.floor(config.collectorSpacing * 1.2));
  for (let y = Math.floor(stride / 2); y < height; y += stride) {
    for (let x = Math.floor(stride / 2); x < width; x += stride) {
      if (!rng.chance(0.22)) continue;
      const index = toIndex(x, y, width);
      if (terrain[index] === WATER || bridgeLayer[index]) continue;
      const target = nearestRoad(roadLayer, terrain, width, height, x, y, Math.floor(stride * 1.4));
      if (target) drawManhattanRoad(roadLayer, terrain, bridgeLayer, width, height, x, y, target.x, target.y);
    }
  }
}

/**
 * Mark land-road intersections as shared crossing tiles so pedestrian networks connect.
 *
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 */
function addPedestrianCrossings(roadLayer, bridgeLayer, terrain, width, height) {
  const crossingInterval = Math.max(20, Math.floor(Math.min(width, height) / 8));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = toIndex(x, y, width);
      if (terrain[index] === WATER || roadLayer[index] === 0) continue;
      if (hasWaterNear(terrain, width, height, x, y, 2)) continue;

      const horizontalRun = roadRunLength(roadLayer, bridgeLayer, terrain, width, height, x, y, -1, 0)
        + roadRunLength(roadLayer, bridgeLayer, terrain, width, height, x, y, 1, 0);
      const verticalRun = roadRunLength(roadLayer, bridgeLayer, terrain, width, height, x, y, 0, -1)
        + roadRunLength(roadLayer, bridgeLayer, terrain, width, height, x, y, 0, 1);

      const isIntersection = horizontalRun >= 4 && verticalRun >= 4;
      const isVerticalCrossing = verticalRun >= 6 && y % crossingInterval === 0;
      const isHorizontalCrossing = horizontalRun >= 6 && x % crossingInterval === 0;

      if (isIntersection || isVerticalCrossing || isHorizontalCrossing) {
        bridgeLayer[index] = 1;
      }
    }
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
function roadRunLength(roadLayer, bridgeLayer, terrain, width, height, x, y, dx, dy) {
  let length = 0;
  let xx = x + dx;
  let yy = y + dy;

  while (xx >= 0 && yy >= 0 && xx < width && yy < height && length < 8) {
    const index = toIndex(xx, yy, width);
    if (terrain[index] === WATER || (roadLayer[index] === 0 && bridgeLayer[index] === 0)) break;
    length += 1;
    xx += dx;
    yy += dy;
  }

  return length;
}

/**
 * @param {Int32Array} blockLayer
 * @param {Uint8Array} terrain
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Int16Array} districtLayer
 * @param {number} width
 * @param {number} height
 * @returns {Block[]}
 */
function extractBlocks(blockLayer, terrain, roadLayer, bridgeLayer, districtLayer, width, height) {
  const blocks = [];
  const queue = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = toIndex(x, y, width);
      if (blockLayer[start] !== -1 || terrain[start] === WATER || roadLayer[start] > 0 || bridgeLayer[start] > 0) continue;

      const blockId = blocks.length;
      const cells = [];
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      const districtCounts = new Map();
      queue.length = 0;
      queue.push(start);
      blockLayer[start] = blockId;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const index = queue[qi];
        const cx = index % width;
        const cy = Math.floor(index / width);
        cells.push(index);
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        const districtId = districtLayer[index];
        if (districtId >= 0) districtCounts.set(districtId, (districtCounts.get(districtId) || 0) + 1);

        for (const next of cardinalNeighbors(cx, cy, width, height)) {
          if (blockLayer[next] !== -1 || terrain[next] === WATER || roadLayer[next] > 0 || bridgeLayer[next] > 0) continue;
          blockLayer[next] = blockId;
          queue.push(next);
        }
      }

      blocks.push({
        id: blockId,
        bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        area: cells.length,
        cells,
        districtId: mostCommonMapKey(districtCounts)
      });
    }
  }

  return blocks.filter((block) => block.area >= 6);
}

/**
 * @param {Int32Array} parcelLayer
 * @param {Block[]} blocks
 * @param {Int16Array} districtLayer
 * @param {Uint8Array} terrain
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @returns {Parcel[]}
 */
function createParcels(parcelLayer, blocks, districtLayer, terrain, roadLayer, width, height, config, rng) {
  const parcels = [];

  for (const block of blocks) {
    if (block.bounds.width < 3 || block.bounds.height < 3) continue;
    const use = chooseBlockUse(block, districtLayer, width, config, rng);
    const slices = splitBlock(block.bounds, rng);

    for (const bounds of slices) {
      const cells = rectCells(bounds, width, height).filter((index) => terrain[index] !== WATER && roadLayer[index] === 0);
      if (cells.length < 4) continue;
      const parcel = {
        id: parcels.length,
        blockId: block.id,
        bounds,
        use
      };
      parcels.push(parcel);
      for (const index of cells) parcelLayer[index] = parcel.id;
    }
  }

  return parcels;
}

/**
 * @param {Int32Array} buildingLayer
 * @param {Parcel[]} parcels
 * @param {Uint8Array} terrain
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {SeededRandom} rng
 * @returns {Building[]}
 */
function createBuildings(buildingLayer, parcels, terrain, roadLayer, bridgeLayer, width, height, rng) {
  const buildings = [];

  for (const parcel of parcels) {
    if (parcel.use === 'park') continue;
    const inset = parcel.use === 'commercial' ? 1 : rng.int(1, 2);
    const footprint = insetRect(parcel.bounds, inset);
    if (footprint.width < 2 || footprint.height < 2) continue;

    let usable = 0;
    forEachRect(footprint, width, height, (x, y, index) => {
      if (terrain[index] !== WATER && roadLayer[index] === 0 && bridgeLayer[index] === 0) usable += 1;
    });
    if (usable < Math.max(4, Math.floor(footprint.width * footprint.height * 0.55))) continue;

    const use = parcel.use === 'civic' ? 'civic' : parcel.use === 'commercial' ? 'commercial' : 'residential';
    const building = {
      id: buildings.length,
      parcelId: parcel.id,
      footprint,
      floors: use === 'commercial' ? rng.int(3, 14) : use === 'civic' ? rng.int(2, 8) : rng.int(1, 5),
      use
    };
    buildings.push(building);
    forEachRect(footprint, width, height, (x, y, index) => {
      if (terrain[index] !== WATER && roadLayer[index] === 0 && bridgeLayer[index] === 0) buildingLayer[index] = building.id;
    });
  }

  return buildings;
}

/**
 * @param {Int16Array} landmarkLayer
 * @param {Parcel[]} parcels
 * @param {Building[]} buildings
 * @param {Uint8Array} terrain
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @returns {Landmark[]}
 */
function createLandmarks(landmarkLayer, parcels, buildings, terrain, roadLayer, width, height, config, rng) {
  const landmarks = [];
  const candidates = parcels
    .filter((parcel) => parcel.bounds.width >= 4 && parcel.bounds.height >= 4)
    .sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height));
  const maxCount = Math.min(config.landmarkCount, candidates.length);
  const names = ['Central Station', 'Founders Plaza', 'Market Tower', 'Civic Forum', 'Harbor Steps', 'Green Oval'];
  const types = ['station', 'plaza', 'tower', 'stadium', 'harbor'];

  for (let i = 0; i < maxCount; i += 1) {
    const candidate = candidates[(i * 3 + rng.int(0, Math.max(0, candidates.length - 1))) % candidates.length];
    if (!candidate) continue;
    const bounds = insetRect(candidate.bounds, Math.max(0, Math.floor(Math.min(candidate.bounds.width, candidate.bounds.height) / 5)));
    if (bounds.width < 3 || bounds.height < 3) continue;
    const landmark = {
      id: landmarks.length,
      name: names[landmarks.length % names.length],
      type: /** @type {'station'|'plaza'|'tower'|'stadium'|'harbor'} */ (types[landmarks.length % types.length]),
      bounds
    };
    landmarks.push(landmark);
    forEachRect(bounds, width, height, (x, y, index) => {
      if (terrain[index] !== WATER && roadLayer[index] === 0) landmarkLayer[index] = landmark.id;
    });
  }

  if (landmarks.length === 0 && buildings.length > 0) {
    const building = buildings[0];
    landmarks.push({ id: 0, name: 'Central Marker', type: 'tower', bounds: building.footprint });
    forEachRect(building.footprint, width, height, (x, y, index) => {
      if (terrain[index] !== WATER && roadLayer[index] === 0) landmarkLayer[index] = 0;
    });
  }

  return landmarks;
}

/**
 * @param {Int16Array} gameplayLayer
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {Int16Array} landmarkLayer
 * @param {number} width
 * @param {number} height
 * @param {SeededRandom} rng
 * @returns {GameplayPoint[]}
 */
function createGameplay(gameplayLayer, roadLayer, bridgeLayer, terrain, landmarkLayer, width, height, rng) {
  const gameplay = [];
  const roles = ['spawn', 'objective', 'service', 'viewpoint'];
  const candidates = [];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = toIndex(x, y, width);
      if (terrain[index] !== WATER && (roadLayer[index] > 0 || bridgeLayer[index] > 0 || landmarkLayer[index] >= 0)) {
        candidates.push({ x, y, score: landmarkLayer[index] >= 0 ? 3 : roadLayer[index] });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const desired = Math.min(16, Math.max(4, Math.floor(Math.sqrt(width * height) / 10)));
  for (let i = 0; i < desired && candidates.length > 0; i += 1) {
    const candidate = candidates.splice(rng.int(0, Math.min(candidates.length - 1, 24)), 1)[0];
    const point = {
      id: gameplay.length,
      type: /** @type {'spawn'|'objective'|'service'|'viewpoint'} */ (roles[gameplay.length % roles.length]),
      x: candidate.x,
      y: candidate.y
    };
    gameplay.push(point);
    gameplayLayer[toIndex(point.x, point.y, width)] = point.id;
  }

  return gameplay;
}

/**
 * @param {Object} args
 * @param {number} args.width
 * @param {number} args.height
 * @param {number} args.tileSize
 * @param {number} args.edgeBand
 * @param {Uint8Array} args.terrain
 * @param {Int16Array} args.districtLayer
 * @param {Uint8Array} args.roadLayer
 * @param {Uint8Array} args.bridgeLayer
 * @param {Int32Array} args.parcelLayer
 * @param {Int32Array} args.buildingLayer
 * @param {Int16Array} args.landmarkLayer
 * @param {District[]} args.districts
 * @param {Parcel[]} args.parcels
 * @returns {CityTiles}
 */
function rasterizeTiles(args) {
  const rows = [];
  const symbols = new Array(args.width);

  for (let y = 0; y < args.height; y += 1) {
    for (let x = 0; x < args.width; x += 1) {
      const index = toIndex(x, y, args.width);
      let symbol = TILE_SYMBOLS.residential;

      if (args.districtLayer[index] >= 0) {
        const district = args.districts[args.districtLayer[index]];
        if (district && (district.type === 'commercial' || district.type === 'downtown' || district.type === 'waterfront')) {
          symbol = TILE_SYMBOLS.commercial;
        }
        if (district && district.type === 'park') symbol = TILE_SYMBOLS.park;
      }

      if (args.parcelLayer[index] >= 0) {
        const parcel = args.parcels[args.parcelLayer[index]];
        if (parcel && parcel.use === 'commercial') symbol = TILE_SYMBOLS.commercial;
        if (parcel && parcel.use === 'park') symbol = TILE_SYMBOLS.park;
      }

      if (args.landmarkLayer[index] >= 0) symbol = TILE_SYMBOLS.commercial;
      if (args.buildingLayer[index] >= 0 && symbol === TILE_SYMBOLS.park) symbol = TILE_SYMBOLS.residential;
      if (isSidewalk(args.terrain, args.roadLayer, args.bridgeLayer, args.width, args.height, x, y)) symbol = TILE_SYMBOLS.sidewalk;
      if (args.roadLayer[index] > 0 && args.terrain[index] !== WATER) symbol = TILE_SYMBOLS.road;
      if (args.terrain[index] === WATER) symbol = TILE_SYMBOLS.water;
      if (args.bridgeLayer[index] > 0) symbol = TILE_SYMBOLS.bridge;
      if (isEdgeBand(x, y, args.width, args.height, args.edgeBand) && args.terrain[index] !== WATER) {
        symbol = (Math.floor(x / 8) + Math.floor(y / 8)) % 5 === 0 ? TILE_SYMBOLS.commercial : TILE_SYMBOLS.residential;
      }

      symbols[x] = symbol;
    }
    rows.push(symbols.join(''));
  }

  return {
    schemaVersion: 1,
    width: args.width,
    height: args.height,
    tileSize: args.tileSize,
    legend: Object.assign({}, LEGEND),
    rows
  };
}

/** @param {GeneratedCity} city @returns {string[]} */
function validateGeneratedCity(city) {
  const warnings = [];
  const width = city.config.width;
  const height = city.config.height;
  const area = width * height;
  const rows = city.tiles.rows;

  if (city.tiles.width !== width || city.tiles.height !== height || city.tiles.tileSize !== city.config.tileSize) {
    warnings.push('Tile metadata does not match resolved config.');
  }
  if (rows.length !== height || rows.some((row) => row.length !== width)) {
    warnings.push('Tile rows do not match configured dimensions.');
  }

  const counts = countSymbols(rows);
  if ((counts.w || 0) < area * 0.025) warnings.push('Water coverage is too low.');
  if ((counts.r || 0) + (counts.b || 0) < area * 0.025) warnings.push('Road coverage is too low.');
  if ((counts.h || 0) + (counts.c || 0) + (counts.p || 0) < area * 0.35) warnings.push('Developable land coverage is too low.');
  if (countVehicleRowComponents(rows, width, height) > 1) warnings.push('Vehicle road network is disconnected.');
  if (countRoadSidewalkRoadArtifacts(rows, width, height) > 0) warnings.push('Road-sidewalk-road artifacts remain.');
  if (city.semantics.blocks.length < Math.max(3, Math.floor(area / 9000))) warnings.push('Too few blocks were extracted.');
  if (city.semantics.parcels.length < Math.max(3, Math.floor(area / 6000))) warnings.push('Too few parcels were created.');
  if (city.semantics.bridges.length < 1 && Math.min(width, height) >= 48) warnings.push('No bridges were created.');
  if (city.config.edgeBand > 0 && edgeBandHasPassableTiles(rows, width, height, city.config.edgeBand)) {
    warnings.push('Edge band contains passable tiles.');
  }

  for (const [symbol, meaning] of Object.entries(LEGEND)) {
    if (city.tiles.legend[symbol] !== meaning) warnings.push(`Legend entry ${symbol} is invalid.`);
  }

  return warnings;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} edgeBand
 * @returns {boolean}
 */
function isEdgeBand(x, y, width, height, edgeBand) {
  return edgeBand > 0 && (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand);
}

/**
 * @param {string[]} rows
 * @param {number} width
 * @param {number} height
 * @param {number} edgeBand
 * @returns {boolean}
 */
function edgeBandHasPassableTiles(rows, width, height, edgeBand) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isEdgeBand(x, y, width, height, edgeBand)) continue;
      if ('rsbp'.includes(rows[y][x])) return true;
    }
  }

  return false;
}

/** @param {number|string} seed @returns {number} */
function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** @param {number} value @param {number} min @param {number} max @param {number} fallback @returns {number} */
function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

/** @param {number} value @param {number} min @param {number} max @param {number} fallback @returns {number} */
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** @param {number} value @param {number} min @param {number} max @returns {number} */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {number} length @param {number} value @returns {Int16Array} */
function fillInt16(length, value) {
  const array = new Int16Array(length);
  array.fill(value);
  return array;
}

/** @param {number} length @param {number} value @returns {Int32Array} */
function fillInt32(length, value) {
  const array = new Int32Array(length);
  array.fill(value);
  return array;
}

/** @param {number} x @param {number} y @param {number} width @returns {number} */
function toIndex(x, y, width) {
  return y * width + x;
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @returns {number} */
function distance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/** @param {Uint8Array} array @param {number} value @returns {number} */
function countValue(array, value) {
  let count = 0;
  for (let i = 0; i < array.length; i += 1) if (array[i] === value) count += 1;
  return count;
}

/**
 * @param {Uint8Array} layer
 * @param {number} width
 * @param {number} height
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} value
 */
function paintDisk(layer, width, height, cx, cy, radius, value) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x < 0 || x >= width) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) layer[toIndex(x, y, width)] = value;
    }
  }
}

/**
 * @param {Uint8Array} layer
 * @param {number} width
 * @param {number} height
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} value
 */
function paintEllipse(layer, width, height, cx, cy, rx, ry, value) {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      if (x < 0 || x >= width) continue;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) layer[toIndex(x, y, width)] = value;
    }
  }
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{x:number,y:number}[]} points
 * @param {number} radius
 * @param {SeededRandom} rng
 */
function paintChunkyChannel(terrain, width, height, points, radius, rng) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const steps = Math.max(1, Math.ceil(distance(start.x, start.y, end.x, end.y)));
    let driftX = 0;
    let driftY = 0;

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      if (step % rng.int(5, 10) === 0) {
        driftX += rng.int(-1, 1);
        driftY += rng.int(-1, 1);
      }

      const wobble = Math.sin((t + i) * Math.PI * 2) * radius * rng.next() * 0.45;
      const x = Math.round(start.x + (end.x - start.x) * t + driftX + (end.y - start.y === 0 ? 0 : wobble));
      const y = Math.round(start.y + (end.y - start.y) * t + driftY + (end.x - start.x === 0 ? 0 : wobble * 0.6));
      paintDisk(terrain, width, height, x, y, radius + rng.int(0, 2), WATER);
    }
  }
}

/**
 * @param {number} width
 * @param {number} height
 * @param {string} recipe
 * @param {number} index
 * @param {SeededRandom} rng
 * @returns {{start:{x:number,y:number},end:{x:number,y:number}}}
 */
function chooseWaterChannelEndpoints(width, height, recipe, index, rng) {
  if (recipe === 'parallelCuts') {
    const edgePair = rng.chance(0.5) ? ['top', 'bottom'] : ['left', 'right'];
    return {
      start: sampleEdgePoint(width, height, edgePair[0], rng, (index + 1) / 4),
      end: sampleEdgePoint(width, height, edgePair[1], rng, (index + 2) / 5)
    };
  }

  if (recipe === 'crossCut') {
    const pairs = [['left', 'right'], ['top', 'bottom'], ['left', 'bottom'], ['top', 'right']];
    const pair = pairs[index % pairs.length];
    return { start: sampleEdgePoint(width, height, pair[0], rng), end: sampleEdgePoint(width, height, pair[1], rng) };
  }

  if (recipe === 'harborAndCanal') {
    const harborEdge = rng.pick(['top', 'right', 'bottom', 'left']);
    const otherEdge = oppositeEdge(harborEdge);
    return { start: sampleEdgePoint(width, height, harborEdge, rng), end: sampleEdgePoint(width, height, otherEdge, rng) };
  }

  const edges = ['top', 'right', 'bottom', 'left'];
  const startEdge = rng.pick(edges);
  let endEdge = rng.pick(edges);
  if (rng.chance(0.68)) {
    while (endEdge === startEdge) endEdge = rng.pick(edges);
  }

  return { start: sampleEdgePoint(width, height, startEdge, rng), end: sampleEdgePoint(width, height, endEdge, rng) };
}

/**
 * @param {number} width
 * @param {number} height
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @param {string} recipe
 * @param {SeededRandom} rng
 * @returns {{x:number,y:number}[]}
 */
function buildWaterControlPoints(width, height, start, end, recipe, rng) {
  const points = [start];
  const bendCount = recipe === 'branch' ? rng.int(1, 2) : rng.int(1, 3);
  const centerPull = recipe === 'bentCanal' ? 0.42 : recipe === 'brokenArchipelago' ? 0.15 : 0.28;

  for (let i = 1; i <= bendCount; i += 1) {
    const t = i / (bendCount + 1);
    const baseX = start.x + (end.x - start.x) * t;
    const baseY = start.y + (end.y - start.y) * t;
    const centerX = width / 2;
    const centerY = height / 2;
    const jitterX = rng.int(-Math.floor(width * 0.18), Math.floor(width * 0.18));
    const jitterY = rng.int(-Math.floor(height * 0.18), Math.floor(height * 0.18));

    points.push({
      x: clamp(Math.round(baseX * (1 - centerPull) + centerX * centerPull + jitterX), -Math.floor(width * 0.12), Math.floor(width * 1.12)),
      y: clamp(Math.round(baseY * (1 - centerPull) + centerY * centerPull + jitterY), -Math.floor(height * 0.12), Math.floor(height * 1.12))
    });
  }

  points.push(end);
  return points;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {string} edge
 * @param {SeededRandom} rng
 * @param {number=} bias
 * @returns {{x:number,y:number}}
 */
function sampleEdgePoint(width, height, edge, rng, bias) {
  const paddedRandom = (size) => {
    const padding = Math.floor(size * 0.08);
    if (bias == null) return rng.int(padding, size - padding - 1);
    return clamp(Math.round(size * bias + rng.int(-padding, padding)), padding, size - padding - 1);
  };

  if (edge === 'top') return { x: paddedRandom(width), y: -Math.floor(height * 0.08) };
  if (edge === 'bottom') return { x: paddedRandom(width), y: height + Math.floor(height * 0.08) };
  if (edge === 'left') return { x: -Math.floor(width * 0.08), y: paddedRandom(height) };
  return { x: width + Math.floor(width * 0.08), y: paddedRandom(height) };
}

/** @param {string} edge @returns {string} */
function oppositeEdge(edge) {
  if (edge === 'top') return 'bottom';
  if (edge === 'bottom') return 'top';
  if (edge === 'left') return 'right';
  return 'left';
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {SeededRandom} rng
 */
function carveEdgeHarbor(terrain, width, height, rng) {
  const edge = rng.pick(['top', 'right', 'bottom', 'left']);
  const cx = edge === 'left' ? 0 : edge === 'right' ? width - 1 : rng.int(Math.floor(width * 0.15), Math.floor(width * 0.85));
  const cy = edge === 'top' ? 0 : edge === 'bottom' ? height - 1 : rng.int(Math.floor(height * 0.15), Math.floor(height * 0.85));
  const rx = rng.int(Math.max(4, Math.floor(width / 24)), Math.max(7, Math.floor(width / 10)));
  const ry = rng.int(Math.max(4, Math.floor(height / 24)), Math.max(7, Math.floor(height / 10)));
  paintEllipse(terrain, width, height, cx, cy, rx, ry, WATER);

  if (rng.chance(0.55)) {
    const inletEnd = {
      x: edge === 'left' || edge === 'right' ? rng.int(Math.floor(width * 0.25), Math.floor(width * 0.75)) : cx + rng.int(-Math.floor(width * 0.2), Math.floor(width * 0.2)),
      y: edge === 'top' || edge === 'bottom' ? rng.int(Math.floor(height * 0.25), Math.floor(height * 0.75)) : cy + rng.int(-Math.floor(height * 0.2), Math.floor(height * 0.2))
    };
    paintChunkyChannel(terrain, width, height, [{ x: cx, y: cy }, inletEnd], Math.max(2, Math.floor(Math.min(width, height) / 54)), rng);
  }
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {SeededRandom} rng
 * @param {number} count
 */
function carveLagoonCluster(terrain, width, height, rng, count) {
  for (let i = 0; i < count; i += 1) {
    const cx = rng.int(Math.floor(width * 0.08), Math.floor(width * 0.92));
    const cy = rng.int(Math.floor(height * 0.08), Math.floor(height * 0.92));
    const rx = rng.int(Math.max(2, Math.floor(width / 60)), Math.max(4, Math.floor(width / 28)));
    const ry = rng.int(Math.max(2, Math.floor(height / 60)), Math.max(4, Math.floor(height / 28)));
    paintEllipse(terrain, width, height, cx, cy, rx, ry, WATER);
  }
}

/**
 * @param {Rect} rect
 * @param {number} width
 * @param {number} height
 * @param {(x:number,y:number,index:number)=>void} callback
 */
function forEachRect(rect, width, height, callback) {
  const maxX = Math.min(width, rect.x + rect.width);
  const maxY = Math.min(height, rect.y + rect.height);
  for (let y = Math.max(0, rect.y); y < maxY; y += 1) {
    for (let x = Math.max(0, rect.x); x < maxX; x += 1) {
      callback(x, y, toIndex(x, y, width));
    }
  }
}

/** @param {Rect} rect @param {number} amount @returns {Rect} */
function insetRect(rect, amount) {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2)
  };
}

/** @param {Rect} rect @param {number} width @param {number} height @returns {number[]} */
function rectCells(rect, width, height) {
  const cells = [];
  forEachRect(rect, width, height, (x, y, index) => cells.push(index));
  return cells;
}

/**
 * @param {number[]} cells
 * @param {number} width
 * @param {number} height
 * @returns {Rect}
 */
function boundsFromCells(cells, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @returns {boolean}
 */
function hasWaterNear(terrain, width, height, cx, cy, radius) {
  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(width - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(height - 1, cy + radius);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (terrain[toIndex(x, y, width)] === WATER) return true;
    }
  }
  return false;
}

/** @param {number} start @param {number} end @param {number} spacing @param {SeededRandom} rng @param {number} jitter @returns {number[]} */
function jitteredLines(start, end, spacing, rng, jitter) {
  const lines = [];
  for (let value = start; value < end; value += spacing) {
    lines.push(clamp(value + rng.int(-jitter, jitter), 0, end - 1));
  }
  return lines;
}

/** @param {number[]} values @returns {number[]} */
function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => Math.round(value)))).sort((a, b) => a - b);
}

/** @param {number} value @param {number[]} values @param {number} distanceLimit @returns {boolean} */
function nearAny(value, values, distanceLimit) {
  return values.some((other) => Math.abs(value - other) <= distanceLimit);
}

/**
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {'horizontal'|'vertical'} orientation
 * @param {'arterial'|'collector'|'local'} hierarchy
 * @returns {RoadSegment}
 */
function drawRoadLine(roadLayer, width, height, x1, y1, x2, y2, orientation, hierarchy) {
  const roadValue = hierarchy === 'arterial' ? 3 : hierarchy === 'collector' ? 2 : 1;
  const roadWidth = hierarchy === 'arterial' ? 4 : 2;
  const offsetStart = -Math.floor((roadWidth - 1) / 2);
  const offsetEnd = offsetStart + roadWidth - 1;

  if (orientation === 'vertical') {
    const x = clamp(Math.round(x1), 0, width - 1);
    const minY = clamp(Math.min(y1, y2), 0, height - 1);
    const maxY = clamp(Math.max(y1, y2), 0, height - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let dx = offsetStart; dx <= offsetEnd; dx += 1) {
        const xx = x + dx;
        if (xx >= 0 && xx < width) roadLayer[toIndex(xx, y, width)] = Math.max(roadLayer[toIndex(xx, y, width)], roadValue);
      }
    }
  } else {
    const y = clamp(Math.round(y1), 0, height - 1);
    const minX = clamp(Math.min(x1, x2), 0, width - 1);
    const maxX = clamp(Math.max(x1, x2), 0, width - 1);
    for (let x = minX; x <= maxX; x += 1) {
      for (let dy = offsetStart; dy <= offsetEnd; dy += 1) {
        const yy = y + dy;
        if (yy >= 0 && yy < height) roadLayer[toIndex(x, yy, width)] = Math.max(roadLayer[toIndex(x, yy, width)], roadValue);
      }
    }
  }

  return { id: -1, hierarchy, orientation, x1, y1, x2, y2 };
}

/**
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {'horizontal'|'vertical'} orientation
 * @param {'collector'|'local'} hierarchy
 * @param {SeededRandom} rng
 * @returns {RoadSegment[]}
 */
function drawSegmentedRoadLine(roadLayer, width, height, x1, y1, x2, y2, orientation, hierarchy, rng) {
  const segments = [];
  const fixed = orientation === 'vertical' ? Math.round(x1) : Math.round(y1);
  const start = orientation === 'vertical' ? Math.min(y1, y2) : Math.min(x1, x2);
  const end = orientation === 'vertical' ? Math.max(y1, y2) : Math.max(x1, x2);
  const total = Math.max(1, end - start + 1);
  const minLength = Math.max(10, Math.floor(total * 0.18));
  const maxLength = Math.max(minLength, Math.floor(total * 0.44));
  let cursor = start;

  while (cursor <= end) {
    const length = rng.int(minLength, maxLength);
    const segmentStart = cursor;
    const segmentEnd = Math.min(end, cursor + length);

    if (!rng.chance(0.28)) {
      segments.push(orientation === 'vertical'
        ? drawRoadLine(roadLayer, width, height, fixed, segmentStart, fixed, segmentEnd, orientation, hierarchy)
        : drawRoadLine(roadLayer, width, height, segmentStart, fixed, segmentEnd, fixed, orientation, hierarchy));
    }

    cursor = segmentEnd + rng.int(5, 12);
  }

  if (segments.length === 0) {
    const center = Math.floor((start + end) / 2);
    const half = Math.max(8, Math.floor(total * 0.18));
    const segmentStart = Math.max(start, center - half);
    const segmentEnd = Math.min(end, center + half);
    segments.push(orientation === 'vertical'
      ? drawRoadLine(roadLayer, width, height, fixed, segmentStart, fixed, segmentEnd, orientation, hierarchy)
      : drawRoadLine(roadLayer, width, height, segmentStart, fixed, segmentEnd, fixed, orientation, hierarchy));
  }

  return segments;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} startX
 * @param {number} startY
 * @param {Uint8Array} visited
 * @returns {number[]}
 */
function collectRoadWaterComponent(roadLayer, terrain, width, height, startX, startY, visited) {
  const cells = [];
  const queue = [toIndex(startX, startY, width)];
  visited[queue[0]] = 1;

  for (let qi = 0; qi < queue.length; qi += 1) {
    const index = queue[qi];
    const x = index % width;
    const y = Math.floor(index / width);
    cells.push(index);

    for (const next of cardinalNeighbors(x, y, width, height)) {
      if (visited[next] || roadLayer[next] === 0 || terrain[next] !== WATER) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }

  return cells;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number[]} cells
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @param {number} id
 * @returns {{id:number,cells:number[],bounds:Rect,orientation:'horizontal'|'vertical',center:{x:number,y:number},eligible:boolean,score:number,roadValue:number}}
 */
function createBridgeCandidate(roadLayer, terrain, width, height, cells, config, rng, id) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let roadValue = 0;

  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    roadValue = Math.max(roadValue, roadLayer[cell]);
  }

  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const orientation = bounds.width >= bounds.height ? 'horizontal' : 'vertical';
  const length = orientation === 'horizontal' ? bounds.width : bounds.height;
  const thickness = orientation === 'horizontal' ? bounds.height : bounds.width;
  const minBridgeLength = Math.max(5, Math.floor(Math.min(width, height) / 40));
  const maxBridgeLength = Math.max(12, Math.floor(Math.min(width, height) / 4));
  const approachReady = hasBridgeApproaches(roadLayer, terrain, width, height, bounds, orientation);
  const eligible = length >= minBridgeLength && length <= maxBridgeLength && thickness <= 5 && approachReady;
  const score = (roadValue * 100)
    + (rng.chance(config.bridgeChance) ? 35 : 0)
    - (length * 1.5)
    - (thickness * 8)
    + (rng.next() * 20);

  return {
    id,
    cells,
    bounds,
    orientation,
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    eligible,
    score,
    roadValue
  };
}

/**
 * @param {{cells:number[],bounds:Rect,orientation:'horizontal'|'vertical'}} bridge
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @returns {{cells:number[],bounds:Rect,orientation:'horizontal'|'vertical'}}
 */
function normalizeBridgeCandidateWidth(bridge, terrain, width, height) {
  const cells = new Set(bridge.cells);
  let bounds = bridge.bounds;
  const thickness = bridge.orientation === 'horizontal' ? bounds.height : bounds.width;

  if (thickness % 2 === 0) {
    return { cells: Array.from(cells), bounds, orientation: bridge.orientation };
  }

  if (bridge.orientation === 'horizontal') {
    const topWater = countWaterOnBridgeExpansionRow(terrain, width, height, bounds.x, bounds.x + bounds.width - 1, bounds.y - 1, 'horizontal');
    const bottomWater = countWaterOnBridgeExpansionRow(terrain, width, height, bounds.x, bounds.x + bounds.width - 1, bounds.y + bounds.height, 'horizontal');
    const y = bottomWater >= topWater ? bounds.y + bounds.height : bounds.y - 1;
    addBridgeExpansionRow(cells, terrain, width, height, bounds.x, bounds.x + bounds.width - 1, y, 'horizontal');
  } else {
    const leftWater = countWaterOnBridgeExpansionRow(terrain, width, height, bounds.y, bounds.y + bounds.height - 1, bounds.x - 1, 'vertical');
    const rightWater = countWaterOnBridgeExpansionRow(terrain, width, height, bounds.y, bounds.y + bounds.height - 1, bounds.x + bounds.width, 'vertical');
    const x = rightWater >= leftWater ? bounds.x + bounds.width : bounds.x - 1;
    addBridgeExpansionRow(cells, terrain, width, height, bounds.y, bounds.y + bounds.height - 1, x, 'vertical');
  }

  bounds = boundsFromCells(Array.from(cells), width, height);
  return { cells: Array.from(cells), bounds, orientation: bridge.orientation };
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} start
 * @param {number} end
 * @param {number} fixed
 * @param {'horizontal'|'vertical'} orientation
 * @returns {number}
 */
function countWaterOnBridgeExpansionRow(terrain, width, height, start, end, fixed, orientation) {
  let count = 0;
  for (let variable = start; variable <= end; variable += 1) {
    const x = orientation === 'horizontal' ? variable : fixed;
    const y = orientation === 'horizontal' ? fixed : variable;
    if (isWaterCell(terrain, width, height, x, y)) count += 1;
  }
  return count;
}

/**
 * @param {Set<number>} cells
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} start
 * @param {number} end
 * @param {number} fixed
 * @param {'horizontal'|'vertical'} orientation
 */
function addBridgeExpansionRow(cells, terrain, width, height, start, end, fixed, orientation) {
  for (let variable = start; variable <= end; variable += 1) {
    const x = orientation === 'horizontal' ? variable : fixed;
    const y = orientation === 'horizontal' ? fixed : variable;
    if (isWaterCell(terrain, width, height, x, y)) cells.add(toIndex(x, y, width));
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {Rect} bounds
 * @param {'horizontal'|'vertical'} orientation
 * @returns {boolean}
 */
function hasBridgeApproaches(roadLayer, terrain, width, height, bounds, orientation) {
  const depth = 4;

  if (orientation === 'horizontal') {
    return hasRoadLandNearRect(roadLayer, terrain, width, height, bounds.x - depth, bounds.y, depth, bounds.height)
      && hasRoadLandNearRect(roadLayer, terrain, width, height, bounds.x + bounds.width, bounds.y, depth, bounds.height);
  }

  return hasRoadLandNearRect(roadLayer, terrain, width, height, bounds.x, bounds.y - depth, bounds.width, depth)
    && hasRoadLandNearRect(roadLayer, terrain, width, height, bounds.x, bounds.y + bounds.height, bounds.width, depth);
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} rectWidth
 * @param {number} rectHeight
 * @returns {boolean}
 */
function hasRoadLandNearRect(roadLayer, terrain, width, height, x, y, rectWidth, rectHeight) {
  const minX = Math.max(0, x);
  const minY = Math.max(0, y);
  const maxX = Math.min(width, x + rectWidth);
  const maxY = Math.min(height, y + rectHeight);

  for (let yy = minY; yy < maxY; yy += 1) {
    for (let xx = minX; xx < maxX; xx += 1) {
      const index = toIndex(xx, yy, width);
      if (terrain[index] !== WATER && roadLayer[index] > 0) return true;
    }
  }

  return false;
}

/**
 * @param {{center:{x:number,y:number}}} candidate
 * @param {{center:{x:number,y:number}}[]} selected
 * @param {number} minDistance
 * @returns {boolean}
 */
function isFarEnoughFromSelectedBridges(candidate, selected, minDistance) {
  if (minDistance <= 0) return true;
  return selected.every((bridge) => distance(candidate.center.x, candidate.center.y, bridge.center.x, bridge.center.y) >= minDistance);
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{bounds:Rect,orientation:'horizontal'|'vertical',roadValue:number}} bridge
 */
function reinforceBridgeApproaches(roadLayer, terrain, width, height, bridge) {
  const depth = 3;
  const value = Math.max(2, bridge.roadValue);

  if (bridge.orientation === 'horizontal') {
    for (let y = bridge.bounds.y; y < bridge.bounds.y + bridge.bounds.height; y += 1) {
      for (let offset = 1; offset <= depth; offset += 1) {
        markRoadIfLand(roadLayer, terrain, width, height, bridge.bounds.x - offset, y, value);
        markRoadIfLand(roadLayer, terrain, width, height, bridge.bounds.x + bridge.bounds.width - 1 + offset, y, value);
      }
    }
    return;
  }

  for (let x = bridge.bounds.x; x < bridge.bounds.x + bridge.bounds.width; x += 1) {
    for (let offset = 1; offset <= depth; offset += 1) {
      markRoadIfLand(roadLayer, terrain, width, height, x, bridge.bounds.y - offset, value);
      markRoadIfLand(roadLayer, terrain, width, height, x, bridge.bounds.y + bridge.bounds.height - 1 + offset, value);
    }
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} value
 */
function markRoadIfLand(roadLayer, terrain, width, height, x, y, value) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = toIndex(x, y, width);
  if (terrain[index] !== WATER) roadLayer[index] = Math.max(roadLayer[index], value);
}

/**
 * Rejected bridge candidates leave behind road approaches on both banks.
 * Trim those approaches back to the nearest crossing road so streets do not
 * visibly terminate at unbridged water.
 *
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{bounds:Rect,orientation:'horizontal'|'vertical'}} bridge
 */
function trimRejectedBridgeApproaches(roadLayer, terrain, width, height, bridge) {
  const maxTrim = Math.max(14, Math.floor(Math.min(width, height) / 6));

  if (bridge.orientation === 'horizontal') {
    trimRoadApproachStrip(roadLayer, terrain, width, height, {
      orientation: 'horizontal',
      start: bridge.bounds.x - 1,
      fixedStart: bridge.bounds.y,
      fixedEnd: bridge.bounds.y + bridge.bounds.height - 1,
      direction: -1,
      maxTrim
    });
    trimRoadApproachStrip(roadLayer, terrain, width, height, {
      orientation: 'horizontal',
      start: bridge.bounds.x + bridge.bounds.width,
      fixedStart: bridge.bounds.y,
      fixedEnd: bridge.bounds.y + bridge.bounds.height - 1,
      direction: 1,
      maxTrim
    });
    return;
  }

  trimRoadApproachStrip(roadLayer, terrain, width, height, {
    orientation: 'vertical',
    start: bridge.bounds.y - 1,
    fixedStart: bridge.bounds.x,
    fixedEnd: bridge.bounds.x + bridge.bounds.width - 1,
    direction: -1,
    maxTrim
  });
  trimRoadApproachStrip(roadLayer, terrain, width, height, {
    orientation: 'vertical',
    start: bridge.bounds.y + bridge.bounds.height,
    fixedStart: bridge.bounds.x,
    fixedEnd: bridge.bounds.x + bridge.bounds.width - 1,
    direction: 1,
    maxTrim
  });
}

/**
 * Remove road corridors that point directly into water where no selected bridge
 * exists. This is intentionally separate from bridge selection because rejected
 * road-water blobs can be irregular near jagged shorelines.
 *
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 */
function trimUnbridgedWaterRoadEnds(roadLayer, bridgeLayer, terrain, width, height) {
  const directions = [
    { waterDx: 1, waterDy: 0, roadDx: -1, roadDy: 0, orientation: 'horizontal', direction: -1 },
    { waterDx: -1, waterDy: 0, roadDx: 1, roadDy: 0, orientation: 'horizontal', direction: 1 },
    { waterDx: 0, waterDy: 1, roadDx: 0, roadDy: -1, orientation: 'vertical', direction: -1 },
    { waterDx: 0, waterDy: -1, roadDx: 0, roadDy: 1, orientation: 'vertical', direction: 1 }
  ];
  const maxTrim = Math.max(14, Math.floor(Math.min(width, height) / 6));

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = toIndex(x, y, width);
      if (terrain[index] === WATER || roadLayer[index] === 0 || bridgeLayer[index] > 0) continue;
      if (hasBridgeNear(bridgeLayer, width, height, x, y, 3)) continue;

      for (const direction of directions) {
        const waterX = x + direction.waterDx;
        const waterY = y + direction.waterDy;
        const roadX = x + direction.roadDx;
        const roadY = y + direction.roadDy;
        if (!isWaterCell(terrain, width, height, waterX, waterY) || bridgeLayer[toIndex(waterX, waterY, width)] > 0) continue;
        if (!isRoadLayerCell(roadLayer, width, height, roadX, roadY)) continue;

        const span = getRoadWidthSpan(roadLayer, terrain, width, height, x, y, direction.orientation);
        trimRoadApproachStrip(roadLayer, terrain, width, height, {
          orientation: direction.orientation,
          start: direction.orientation === 'horizontal' ? x : y,
          fixedStart: span.start,
          fixedEnd: span.end,
          direction: direction.direction,
          maxTrim
        });
        break;
      }
    }
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{orientation:'horizontal'|'vertical',start:number,fixedStart:number,fixedEnd:number,direction:number,maxTrim:number}} strip
 */
function trimRoadApproachStrip(roadLayer, terrain, width, height, strip) {
  for (let step = 0; step < strip.maxTrim; step += 1) {
    const variable = strip.start + strip.direction * step;
    if (variable < 0 || variable >= (strip.orientation === 'horizontal' ? width : height)) break;
    if (step > 0 && hasPerpendicularRoadAtStrip(roadLayer, width, height, strip, variable)) break;

    let hadRoad = false;
    for (let fixed = strip.fixedStart; fixed <= strip.fixedEnd; fixed += 1) {
      const x = strip.orientation === 'horizontal' ? variable : fixed;
      const y = strip.orientation === 'horizontal' ? fixed : variable;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = toIndex(x, y, width);
      if (terrain[index] === WATER || roadLayer[index] === 0) continue;
      hadRoad = true;
      roadLayer[index] = 0;
    }

    if (!hadRoad && step > 1) break;
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {{orientation:'horizontal'|'vertical',fixedStart:number,fixedEnd:number}} strip
 * @param {number} variable
 * @returns {boolean}
 */
function hasPerpendicularRoadAtStrip(roadLayer, width, height, strip, variable) {
  if (strip.orientation === 'horizontal') {
    return isRoadLayerCell(roadLayer, width, height, variable, strip.fixedStart - 1)
      || isRoadLayerCell(roadLayer, width, height, variable, strip.fixedEnd + 1);
  }

  return isRoadLayerCell(roadLayer, width, height, strip.fixedStart - 1, variable)
    || isRoadLayerCell(roadLayer, width, height, strip.fixedEnd + 1, variable);
}

/**
 * @param {Uint8Array} roadLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isRoadLayerCell(roadLayer, width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height && roadLayer[toIndex(x, y, width)] > 0;
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isWaterCell(terrain, width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height && terrain[toIndex(x, y, width)] === WATER;
}

/**
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {boolean}
 */
function hasBridgeNear(bridgeLayer, width, height, x, y, radius) {
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      if (bridgeLayer[toIndex(xx, yy, width)] > 0) return true;
    }
  }

  return false;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {'horizontal'|'vertical'} orientation
 * @returns {{start:number,end:number}}
 */
function getRoadWidthSpan(roadLayer, terrain, width, height, x, y, orientation) {
  let start = orientation === 'horizontal' ? y : x;
  let end = start;
  const fixed = orientation === 'horizontal' ? x : y;
  const maxWidth = 4;

  for (let offset = 1; offset <= maxWidth; offset += 1) {
    const variable = start - 1;
    const xx = orientation === 'horizontal' ? fixed : variable;
    const yy = orientation === 'horizontal' ? variable : fixed;
    if (!isRoadLayerCell(roadLayer, width, height, xx, yy) || isWaterCell(terrain, width, height, xx, yy)) break;
    start = variable;
  }

  for (let offset = 1; offset <= maxWidth; offset += 1) {
    const variable = end + 1;
    const xx = orientation === 'horizontal' ? fixed : variable;
    const yy = orientation === 'horizontal' ? variable : fixed;
    if (!isRoadLayerCell(roadLayer, width, height, xx, yy) || isWaterCell(terrain, width, height, xx, yy)) break;
    end = variable;
  }

  return { start, end };
}

/**
 * Merge one-tile slivers between parallel road cells so the rasterized map
 * cannot produce road-sidewalk-road stripes.
 *
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 */
function collapseNarrowRoadGaps(roadLayer, bridgeLayer, terrain, width, height) {
  for (let pass = 0; pass < 2; pass += 1) {
    const fills = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = toIndex(x, y, width);
        if (terrain[index] === WATER || roadLayer[index] > 0 || bridgeLayer[index] > 0) continue;

        const left = roadNeighborValue(roadLayer, bridgeLayer, toIndex(x - 1, y, width));
        const right = roadNeighborValue(roadLayer, bridgeLayer, toIndex(x + 1, y, width));
        const up = roadNeighborValue(roadLayer, bridgeLayer, toIndex(x, y - 1, width));
        const down = roadNeighborValue(roadLayer, bridgeLayer, toIndex(x, y + 1, width));

        if ((left > 0 && right > 0) || (up > 0 && down > 0)) {
          fills.push({ index, value: Math.max(left, right, up, down, 1) });
        }
      }
    }

    if (fills.length === 0) return;
    for (const fill of fills) roadLayer[fill.index] = fill.value;
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} index
 * @returns {number}
 */
function roadNeighborValue(roadLayer, bridgeLayer, index) {
  return roadLayer[index] > 0 ? roadLayer[index] : bridgeLayer[index] > 0 ? 2 : 0;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} limit
 */
function pruneTinyRoadComponents(roadLayer, bridgeLayer, width, height, limit) {
  const components = getRoadComponents(roadLayer, bridgeLayer, width, height);
  if (components.length <= 1) return;

  for (const component of components) {
    if (component.cells.length <= limit) clearRoadComponent(roadLayer, bridgeLayer, component);
  }
}

/**
 * Ensure all meaningful vehicle road cells share one connected component.
 * Small road specks are removed; larger disconnected components are joined by
 * even-width connectors, with bridge tiles used only where the connector crosses water.
 *
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} nextBridgeId
 * @returns {Bridge[]}
 */
function connectRoadNetwork(roadLayer, bridgeLayer, terrain, width, height, nextBridgeId) {
  const addedBridges = [];
  const tinyComponentLimit = 12;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    let components = getRoadComponents(roadLayer, bridgeLayer, width, height);
    const tinyComponents = components.filter((component) => component.cells.length <= tinyComponentLimit);

    for (const component of tinyComponents) clearRoadComponent(roadLayer, bridgeLayer, component);
    if (tinyComponents.length > 0) components = getRoadComponents(roadLayer, bridgeLayer, width, height);
    if (components.length <= 1) break;

    components.sort((a, b) => b.cells.length - a.cells.length);
    const pair = findNearestRoadComponentPair(components, width);
    if (!pair) break;

    const bridgeCells = drawRoadConnector(roadLayer, bridgeLayer, terrain, width, height, pair.from, pair.to);
    const bridgeRuns = cellsToBridgeRuns(bridgeCells, width, height, nextBridgeId + addedBridges.length);
    addedBridges.push(...bridgeRuns);
  }

  return addedBridges;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @returns {{id:number,cells:number[]}[]}
 */
function getRoadComponents(roadLayer, bridgeLayer, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = toIndex(x, y, width);
      if (visited[start] || !isVehicleLayerCell(roadLayer, bridgeLayer, start)) continue;

      const cells = [];
      const queue = [start];
      visited[start] = 1;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const index = queue[qi];
        const cx = index % width;
        const cy = Math.floor(index / width);
        cells.push(index);

        for (const next of cardinalNeighbors(cx, cy, width, height)) {
          if (visited[next] || !isVehicleLayerCell(roadLayer, bridgeLayer, next)) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }

      components.push({ id: components.length, cells });
    }
  }

  return components;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} index
 * @returns {boolean}
 */
function isVehicleLayerCell(roadLayer, bridgeLayer, index) {
  return roadLayer[index] > 0 || bridgeLayer[index] > 0;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isVehicleLayerPoint(roadLayer, bridgeLayer, width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height && isVehicleLayerCell(roadLayer, bridgeLayer, toIndex(x, y, width));
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {{cells:number[]}} component
 */
function clearRoadComponent(roadLayer, bridgeLayer, component) {
  for (const index of component.cells) {
    roadLayer[index] = 0;
    bridgeLayer[index] = 0;
  }
}

/**
 * @param {{cells:number[]}[]} components
 * @param {number} width
 * @returns {{from:{x:number,y:number},to:{x:number,y:number}}|null}
 */
function findNearestRoadComponentPair(components, width) {
  if (components.length < 2) return null;

  const mainSamples = sampleComponentCells(components[0], width, 900);
  let best = null;
  let bestDistance = Infinity;

  for (let i = 1; i < components.length; i += 1) {
    const samples = sampleComponentCells(components[i], width, 500);
    for (const from of mainSamples) {
      for (const to of samples) {
        const score = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        if (score < bestDistance) {
          bestDistance = score;
          best = { from, to };
        }
      }
    }
  }

  return best;
}

/**
 * @param {{cells:number[]}} component
 * @param {number} width
 * @param {number} limit
 * @returns {{x:number,y:number}[]}
 */
function sampleComponentCells(component, width, limit) {
  if (component.cells.length <= limit) {
    return component.cells.map((index) => ({ x: index % width, y: Math.floor(index / width) }));
  }

  const samples = [];
  const step = component.cells.length / limit;
  for (let i = 0; i < limit; i += 1) {
    const index = component.cells[Math.floor(i * step)];
    samples.push({ x: index % width, y: Math.floor(index / width) });
  }
  return samples;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @returns {number[]}
 */
function drawRoadConnector(roadLayer, bridgeLayer, terrain, width, height, from, to) {
  const horizontalFirstCost = connectorCost(terrain, width, height, from, to, true);
  const horizontalFirst = horizontalFirstCost <= connectorCost(terrain, width, height, from, to, false);
  const bridgeCells = [];

  if (horizontalFirst) {
    drawConnectorSegment(roadLayer, bridgeLayer, terrain, width, height, from.x, from.y, to.x, from.y, 'horizontal', bridgeCells);
    drawConnectorSegment(roadLayer, bridgeLayer, terrain, width, height, to.x, from.y, to.x, to.y, 'vertical', bridgeCells);
  } else {
    drawConnectorSegment(roadLayer, bridgeLayer, terrain, width, height, from.x, from.y, from.x, to.y, 'vertical', bridgeCells);
    drawConnectorSegment(roadLayer, bridgeLayer, terrain, width, height, from.x, to.y, to.x, to.y, 'horizontal', bridgeCells);
  }

  return bridgeCells;
}

/**
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {boolean} horizontalFirst
 * @returns {number}
 */
function connectorCost(terrain, width, height, from, to, horizontalFirst) {
  let cost = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  const cells = horizontalFirst
    ? connectorPathCells(from.x, from.y, to.x, from.y, to.x, to.y)
    : connectorPathCells(from.x, from.y, from.x, to.y, to.x, to.y);

  for (const point of cells) {
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) continue;
    if (terrain[toIndex(point.x, point.y, width)] === WATER) cost += 6;
  }

  return cost;
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} x3
 * @param {number} y3
 * @returns {{x:number,y:number}[]}
 */
function connectorPathCells(x1, y1, x2, y2, x3, y3) {
  const cells = [];
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) cells.push({ x, y: y1 });
  for (let y = Math.min(y2, y3); y <= Math.max(y2, y3); y += 1) cells.push({ x: x2, y });
  return cells;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {'horizontal'|'vertical'} orientation
 * @param {number[]} bridgeCells
 */
function drawConnectorSegment(roadLayer, bridgeLayer, terrain, width, height, x1, y1, x2, y2, orientation, bridgeCells) {
  if (orientation === 'horizontal') {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
      for (let dy = 0; dy < 2; dy += 1) markConnectorCell(roadLayer, bridgeLayer, terrain, width, height, x, y1 + dy, bridgeCells);
    }
    return;
  }

  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
    for (let dx = 0; dx < 2; dx += 1) markConnectorCell(roadLayer, bridgeLayer, terrain, width, height, x1 + dx, y, bridgeCells);
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number[]} bridgeCells
 */
function markConnectorCell(roadLayer, bridgeLayer, terrain, width, height, x, y, bridgeCells) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = toIndex(x, y, width);
  if (terrain[index] === WATER) {
    if (bridgeLayer[index] === 0) bridgeCells.push(index);
    bridgeLayer[index] = 1;
    return;
  }

  roadLayer[index] = Math.max(roadLayer[index], 2);
}

/**
 * @param {number[]} cells
 * @param {number} width
 * @param {number} height
 * @param {number} startId
 * @returns {Bridge[]}
 */
function cellsToBridgeRuns(cells, width, height, startId) {
  const cellSet = new Set(cells);
  const bridges = [];

  while (cellSet.size > 0) {
    const first = cellSet.values().next().value;
    const queue = [first];
    cellSet.delete(first);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let qi = 0; qi < queue.length; qi += 1) {
      const index = queue[qi];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const next of cardinalNeighbors(x, y, width, height)) {
        if (!cellSet.has(next)) continue;
        cellSet.delete(next);
        queue.push(next);
      }
    }

    bridges.push({
      id: startId + bridges.length,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      orientation: maxX - minX >= maxY - minY ? 'horizontal' : 'vertical'
    });
  }

  return bridges;
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 */
function drawManhattanRoad(roadLayer, terrain, bridgeLayer, width, height, x1, y1, x2, y2) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
    for (let dy = 0; dy < 2; dy += 1) markLocalRoadIfLand(roadLayer, terrain, bridgeLayer, width, height, x, y1 + dy);
  }

  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
    for (let dx = 0; dx < 2; dx += 1) markLocalRoadIfLand(roadLayer, terrain, bridgeLayer, width, height, x2 + dx, y);
  }
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 */
function markLocalRoadIfLand(roadLayer, terrain, bridgeLayer, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = toIndex(x, y, width);
  if (terrain[index] !== WATER && bridgeLayer[index] === 0) roadLayer[index] = Math.max(roadLayer[index], 1);
}

/**
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} terrain
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {{x:number,y:number}|null}
 */
function nearestRoad(roadLayer, terrain, width, height, x, y, radius) {
  let best = null;
  let bestDistance = Infinity;
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
      const index = toIndex(xx, yy, width);
      if (terrain[index] === WATER || roadLayer[index] === 0) continue;
      const score = Math.abs(xx - x) + Math.abs(yy - y);
      if (score < bestDistance) {
        bestDistance = score;
        best = { x: xx, y: yy };
      }
    }
  }
  return best;
}

/** @param {number} x @param {number} y @param {number} width @param {number} height @returns {number[]} */
function cardinalNeighbors(x, y, width, height) {
  const neighbors = [];
  if (x > 0) neighbors.push(toIndex(x - 1, y, width));
  if (x < width - 1) neighbors.push(toIndex(x + 1, y, width));
  if (y > 0) neighbors.push(toIndex(x, y - 1, width));
  if (y < height - 1) neighbors.push(toIndex(x, y + 1, width));
  return neighbors;
}

/** @param {Map<number, number>} map @returns {number|null} */
function mostCommonMapKey(map) {
  let bestKey = null;
  let bestValue = -1;
  for (const [key, value] of map.entries()) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

/**
 * @param {Block} block
 * @param {Int16Array} districtLayer
 * @param {number} width
 * @param {Required<CityGeneratorConfig>} config
 * @param {SeededRandom} rng
 * @returns {'residential'|'commercial'|'park'|'civic'}
 */
function chooseBlockUse(block, districtLayer, width, config, rng) {
  const sample = block.cells[Math.floor(block.cells.length / 2)] || block.cells[0];
  const districtId = sample == null ? -1 : districtLayer[sample];
  const large = block.bounds.width * block.bounds.height > 180;

  if (large && rng.chance(config.parkChance)) return 'park';
  if (large && rng.chance(0.04)) return 'civic';
  if (districtId >= 0) {
    const centerX = sample % width;
    const centerish = Math.abs(centerX - width / 2) < width * 0.18;
    if (centerish && rng.chance(0.55)) return 'commercial';
  }
  if (rng.chance(0.18)) return 'commercial';
  return 'residential';
}

/** @param {Rect} bounds @param {SeededRandom} rng @returns {Rect[]} */
function splitBlock(bounds, rng) {
  const parcels = [];
  const minParcel = 4;
  const vertical = bounds.width >= bounds.height;

  if ((vertical && bounds.width >= minParcel * 2) || (!vertical && bounds.height >= minParcel * 2)) {
    const total = vertical ? bounds.width : bounds.height;
    let cursor = 0;
    while (cursor < total) {
      const remaining = total - cursor;
      const size = remaining <= minParcel * 2 ? remaining : rng.int(minParcel, Math.min(12, remaining - minParcel));
      parcels.push(vertical
        ? { x: bounds.x + cursor, y: bounds.y, width: size, height: bounds.height }
        : { x: bounds.x, y: bounds.y + cursor, width: bounds.width, height: size });
      cursor += size;
    }
  } else {
    parcels.push(bounds);
  }

  return parcels;
}

/**
 * @param {Uint8Array} terrain
 * @param {Uint8Array} roadLayer
 * @param {Uint8Array} bridgeLayer
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isSidewalk(terrain, roadLayer, bridgeLayer, width, height, x, y) {
  const index = toIndex(x, y, width);
  if (terrain[index] === WATER || roadLayer[index] > 0 || bridgeLayer[index] > 0) return false;
  if ((isVehicleLayerPoint(roadLayer, bridgeLayer, width, height, x - 1, y) && isVehicleLayerPoint(roadLayer, bridgeLayer, width, height, x + 1, y))
    || (isVehicleLayerPoint(roadLayer, bridgeLayer, width, height, x, y - 1) && isVehicleLayerPoint(roadLayer, bridgeLayer, width, height, x, y + 1))) {
    return false;
  }

  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
      const neighbor = toIndex(xx, yy, width);
      if (roadLayer[neighbor] > 0 || bridgeLayer[neighbor] > 0) return true;
    }
  }
  return false;
}

/** @param {string[]} rows @returns {Record<string, number>} */
function countSymbols(rows) {
  const counts = {};
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      counts[row[i]] = (counts[row[i]] || 0) + 1;
    }
  }
  return counts;
}

/**
 * @param {string[]} rows
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function countVehicleRowComponents(rows, width, height) {
  const visited = new Uint8Array(width * height);
  let components = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = toIndex(x, y, width);
      if (visited[start] || !isVehicleSymbol(rows[y][x])) continue;

      components += 1;
      const queue = [start];
      visited[start] = 1;

      for (let qi = 0; qi < queue.length; qi += 1) {
        const index = queue[qi];
        const cx = index % width;
        const cy = Math.floor(index / width);

        for (const next of cardinalNeighbors(cx, cy, width, height)) {
          const nx = next % width;
          const ny = Math.floor(next / width);
          if (visited[next] || !isVehicleSymbol(rows[ny][nx])) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
  }

  return components;
}

/**
 * @param {string[]} rows
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function countRoadSidewalkRoadArtifacts(rows, width, height) {
  let artifacts = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (rows[y][x] !== TILE_SYMBOLS.sidewalk) continue;
      if ((isVehicleSymbol(rows[y][x - 1]) && isVehicleSymbol(rows[y][x + 1]))
        || (isVehicleSymbol(rows[y - 1][x]) && isVehicleSymbol(rows[y + 1][x]))) {
        artifacts += 1;
      }
    }
  }

  return artifacts;
}

/** @param {string} symbol @returns {boolean} */
function isVehicleSymbol(symbol) {
  return symbol === TILE_SYMBOLS.road || symbol === TILE_SYMBOLS.bridge;
}

if (typeof window !== 'undefined') {
  window.CityMapGenerator = CityMapGenerator;
  window.defaultCityGeneratorConfig = defaultCityGeneratorConfig;
}

if (isDirectNodeExecution()) {
  await runCli();
}

export { CityMapGenerator, defaultCityGeneratorConfig, generate };
export default CityMapGenerator;

/** @returns {boolean} */
function isDirectNodeExecution() {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node || !process.argv || !process.argv[1]) {
    return false;
  }

  try {
    return import.meta.url === new URL(process.argv[1], 'file:').href;
  } catch (error) {
    return false;
  }
}

/** @returns {Promise<void>} */
async function runCli() {
  try {
    const options = parseCliArgs(process.argv.slice(2));

    if (options.help) {
      console.log([
        'Usage: node city-generator.js [options]',
        '',
        'Options:',
        '  --seed <value>       Deterministic seed.',
        '  --width <number>     Tile grid width.',
        '  --height <number>    Tile grid height.',
        '  --tileSize <number>  World-space tile size.',
        '  --edgeBand <number>  Non-passable building border width.',
        '  --maxWaterBridges <n> Maximum water bridge corridors.',
        '  --minBridgeDistance <n> Minimum spacing between water bridges.',
        '  --out <path>         Write map JSON to a file. Defaults to stdout.',
        '  --pretty            Pretty-print JSON output.',
        '  --help              Show this help text.'
      ].join('\n'));
      return;
    }

    const city = generate(options.config);
    const json = JSON.stringify(city.tiles, null, options.pretty ? 2 : 0);

    if (options.out) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(options.out, `${json}\n`, 'utf8');
      console.error(`Wrote ${city.tiles.width}x${city.tiles.height} city map to ${options.out}`);
      if (!city.validation.valid) {
        console.error(`Validation warnings: ${city.validation.warnings.join('; ')}`);
      }
      return;
    }

    console.log(json);
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * @param {string[]} args
 * @returns {{config:CityGeneratorConfig,out:string|null,pretty:boolean,help:boolean}}
 */
function parseCliArgs(args) {
  const config = {};
  let out = null;
  let pretty = false;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--pretty') {
      pretty = true;
      continue;
    }

    const nextValue = () => {
      if (i + 1 >= args.length) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return args[i];
    };

    if (arg === '--seed') {
      config.seed = nextValue();
    } else if (arg === '--width') {
      config.width = numberArg(arg, nextValue());
    } else if (arg === '--height') {
      config.height = numberArg(arg, nextValue());
    } else if (arg === '--tileSize' || arg === '--tile-size') {
      config.tileSize = numberArg(arg, nextValue());
    } else if (arg === '--edgeBand' || arg === '--edge-band') {
      config.edgeBand = numberArg(arg, nextValue());
    } else if (arg === '--maxWaterBridges' || arg === '--max-water-bridges') {
      config.maxWaterBridges = numberArg(arg, nextValue());
    } else if (arg === '--minBridgeDistance' || arg === '--min-bridge-distance') {
      config.minBridgeDistance = numberArg(arg, nextValue());
    } else if (arg === '--out' || arg === '-o') {
      out = nextValue();
    } else if (arg.startsWith('--seed=')) {
      config.seed = arg.slice('--seed='.length);
    } else if (arg.startsWith('--width=')) {
      config.width = numberArg('--width', arg.slice('--width='.length));
    } else if (arg.startsWith('--height=')) {
      config.height = numberArg('--height', arg.slice('--height='.length));
    } else if (arg.startsWith('--tileSize=')) {
      config.tileSize = numberArg('--tileSize', arg.slice('--tileSize='.length));
    } else if (arg.startsWith('--tile-size=')) {
      config.tileSize = numberArg('--tile-size', arg.slice('--tile-size='.length));
    } else if (arg.startsWith('--edgeBand=')) {
      config.edgeBand = numberArg('--edgeBand', arg.slice('--edgeBand='.length));
    } else if (arg.startsWith('--edge-band=')) {
      config.edgeBand = numberArg('--edge-band', arg.slice('--edge-band='.length));
    } else if (arg.startsWith('--maxWaterBridges=')) {
      config.maxWaterBridges = numberArg('--maxWaterBridges', arg.slice('--maxWaterBridges='.length));
    } else if (arg.startsWith('--max-water-bridges=')) {
      config.maxWaterBridges = numberArg('--max-water-bridges', arg.slice('--max-water-bridges='.length));
    } else if (arg.startsWith('--minBridgeDistance=')) {
      config.minBridgeDistance = numberArg('--minBridgeDistance', arg.slice('--minBridgeDistance='.length));
    } else if (arg.startsWith('--min-bridge-distance=')) {
      config.minBridgeDistance = numberArg('--min-bridge-distance', arg.slice('--min-bridge-distance='.length));
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { config, out, pretty, help };
}

/** @param {string} name @param {string} value @returns {number} */
function numberArg(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number.`);
  return number;
}
