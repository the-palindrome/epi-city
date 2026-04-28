#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const LABELS_PATH = path.join(TOOL_DIR, 'labels/tile-labels.json');
const TRAINER_PATH = path.join(TOOL_DIR, 'train_random_forest.py');
const VENV_PYTHON_PATH = process.platform === 'win32'
  ? path.join(TOOL_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(TOOL_DIR, '.venv', 'bin', 'python');
const SOURCE_IMAGE_PATH = path.join(REPO_ROOT, 'process_gta_map/source/gta1-liberty-city-hd.webp');
const DEFAULT_MAP_PATH = path.join(REPO_ROOT, 'public/liberty-city.json');
const PORT = Number(process.env.PORT || 5174);
const GRID_SIZE = 256;

const TYPE_LABEL_OPTIONS = Object.freeze(['road', 'sidewalk', 'park', 'water', 'bridge', 'building']);
const BEHAVIOR_LABEL_OPTIONS = Object.freeze(['walkable', 'parkable', 'drivable']);
const SAFE_SYMBOLS = Object.freeze([...('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;<=>?@[]^_{|}~')]);
const DEFAULT_SUBCATEGORY_BY_TYPE = Object.freeze({
  road: 'classified',
  sidewalk: 'classified',
  park: 'park',
  water: 'classified',
  bridge: 'classified',
  building: 'classified'
});

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function sendFile(request, response, filePath, contentType) {
  try {
    const info = await stat(filePath);
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'cache-control': 'no-store'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendError(response, 404, `Could not read ${filePath}: ${error.message}`);
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) {
      return fallback;
    }

    throw error;
  }
}

async function readRequestJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function emptyLabelFile() {
  return {
    sourceImage: path.relative(REPO_ROOT, SOURCE_IMAGE_PATH),
    generatedMap: path.relative(REPO_ROOT, DEFAULT_MAP_PATH),
    gridSize: GRID_SIZE,
    typeLabels: [],
    behaviorLabels: Object.fromEntries(BEHAVIOR_LABEL_OPTIONS.map((property) => [property, []]))
  };
}

function normalizeLabelsFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Label file must be an object.');
  }

  const normalized = emptyLabelFile();
  normalized.sourceImage = data.sourceImage || normalized.sourceImage;
  normalized.generatedMap = data.generatedMap || normalized.generatedMap;
  normalized.gridSize = data.gridSize;
  normalized.typeLabels = Array.isArray(data.typeLabels) ? data.typeLabels : Array.isArray(data.labels) ? data.labels : [];

  if (data.behaviorLabels && typeof data.behaviorLabels === 'object' && !Array.isArray(data.behaviorLabels)) {
    for (const property of BEHAVIOR_LABEL_OPTIONS) {
      normalized.behaviorLabels[property] = Array.isArray(data.behaviorLabels[property]) ? data.behaviorLabels[property] : [];
    }
  }

  validateLabelsFile(normalized);
  return normalized;
}

function validateLabelsFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Label file must be an object.');
  }

  if (!Number.isInteger(data.gridSize) || data.gridSize !== GRID_SIZE) {
    throw new Error(`Label file gridSize must be ${GRID_SIZE}.`);
  }

  if (!Array.isArray(data.typeLabels)) {
    throw new Error('Label file typeLabels must be an array.');
  }

  validateTypeLabels(data.typeLabels);

  if (!data.behaviorLabels || typeof data.behaviorLabels !== 'object' || Array.isArray(data.behaviorLabels)) {
    throw new Error('Label file behaviorLabels must be an object.');
  }

  for (const property of BEHAVIOR_LABEL_OPTIONS) {
    if (!Array.isArray(data.behaviorLabels[property])) {
      throw new Error(`Label file behaviorLabels.${property} must be an array.`);
    }

    validateBehaviorLabels(property, data.behaviorLabels[property]);
  }
}

function validateTypeLabels(entries) {
  const seen = new Set();

  for (const entry of entries) {
    validateCoordinateEntry(entry, 'type label');

    if (!TYPE_LABEL_OPTIONS.includes(entry.label)) {
      throw new Error(`Invalid type label category: ${entry.label}.`);
    }

    checkDuplicate(seen, entry.x, entry.y, 'type label');
  }
}

function validateBehaviorLabels(property, entries) {
  const seen = new Set();

  for (const entry of entries) {
    validateCoordinateEntry(entry, `${property} label`);

    if (typeof entry.value !== 'boolean') {
      throw new Error(`${property} label at ${entry.x},${entry.y} must include boolean value.`);
    }

    checkDuplicate(seen, entry.x, entry.y, property);
  }
}

function validateCoordinateEntry(entry, labelName) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Each ${labelName} entry must be an object.`);
  }

  if (!Number.isInteger(entry.x) || entry.x < 0 || entry.x >= GRID_SIZE) {
    throw new Error(`Invalid ${labelName} x coordinate: ${entry.x}.`);
  }

  if (!Number.isInteger(entry.y) || entry.y < 0 || entry.y >= GRID_SIZE) {
    throw new Error(`Invalid ${labelName} y coordinate: ${entry.y}.`);
  }
}

function checkDuplicate(seen, x, y, labelName) {
  const key = `${x},${y}`;

  if (seen.has(key)) {
    throw new Error(`Duplicate ${labelName} entry for tile ${key}.`);
  }

  seen.add(key);
}

async function loadCurrentClassification(mapPath = path.relative(REPO_ROOT, DEFAULT_MAP_PATH)) {
  const absoluteMapPath = resolveMapPath(mapPath);
  const relativeMapPath = path.relative(REPO_ROOT, absoluteMapPath);
  const map = await readJsonFile(absoluteMapPath);

  return classificationFromEpiCityMap(map, relativeMapPath);
}

function classificationFromEpiCityMap(map, sourceMap) {
  const legend = map.legend || {};
  const rows = [];
  const behaviorRows = Object.fromEntries(BEHAVIOR_LABEL_OPTIONS.map((property) => [property, []]));
  const counts = Object.fromEntries([...TYPE_LABEL_OPTIONS, 'unknown'].map((label) => [label, 0]));
  const behaviorCounts = Object.fromEntries(BEHAVIOR_LABEL_OPTIONS.map((property) => [property, { true: 0, false: 0 }]));

  if (!Number.isInteger(map.width) || map.width !== GRID_SIZE || !Number.isInteger(map.height) || map.height !== GRID_SIZE) {
    throw new Error(`Epi City map must be ${GRID_SIZE}x${GRID_SIZE}.`);
  }

  if (!Array.isArray(map.rows) || map.rows.length !== GRID_SIZE) {
    throw new Error(`Epi City map rows must contain ${GRID_SIZE} rows.`);
  }

  for (let y = 0; y < GRID_SIZE; y += 1) {
    const sourceRow = map.rows[y];
    const row = [];
    const behaviorRowMap = Object.fromEntries(BEHAVIOR_LABEL_OPTIONS.map((property) => [property, []]));

    if (typeof sourceRow !== 'string' || sourceRow.length !== GRID_SIZE) {
      throw new Error(`Epi City map row ${y} must contain ${GRID_SIZE} symbols.`);
    }

    for (let x = 0; x < GRID_SIZE; x += 1) {
      const entry = legend[sourceRow[x]];
      let label = 'unknown';

      if (entry) {
        label = entry.category === 'sidewalk' && entry.subcategory === 'park' ? 'park' : entry.category;
      }

      row.push(label);
      counts[label] = (counts[label] || 0) + 1;

      for (const property of BEHAVIOR_LABEL_OPTIONS) {
        const value = Boolean(entry && entry[property]);
        behaviorRowMap[property].push(value);
        behaviorCounts[property][String(value)] += 1;
      }
    }

    rows.push(row);

    for (const property of BEHAVIOR_LABEL_OPTIONS) {
      behaviorRows[property].push(behaviorRowMap[property]);
    }
  }

  return {
    sourceMap,
    mapPath: sourceMap,
    gridSize: GRID_SIZE,
    rows,
    behaviorRows,
    counts,
    behaviorCounts
  };
}

async function saveEpiCityMap(classification) {
  validateClassificationPayload(classification);
  const absoluteMapPath = resolveMapPath(classification.mapPath || path.relative(REPO_ROOT, DEFAULT_MAP_PATH));
  const existingMap = await readJsonFile(absoluteMapPath);
  const nextMap = buildEpiCityMap(existingMap, classification.rows, classification.behaviorRows);
  const relativeMapPath = path.relative(REPO_ROOT, absoluteMapPath);

  await writeEpiCityMap(absoluteMapPath, nextMap);
  return {
    path: relativeMapPath,
    classification: classificationFromEpiCityMap(nextMap, relativeMapPath)
  };
}

function resolveMapPath(mapPath) {
  if (typeof mapPath !== 'string' || mapPath.length === 0) {
    throw new Error('Map path must be a non-empty string.');
  }

  const absoluteMapPath = path.resolve(REPO_ROOT, mapPath);
  const relativeMapPath = path.relative(REPO_ROOT, absoluteMapPath);

  if (relativeMapPath.startsWith('..') || path.isAbsolute(relativeMapPath)) {
    throw new Error(`Map path must stay inside the repository: ${mapPath}`);
  }

  if (path.extname(absoluteMapPath) !== '.json') {
    throw new Error(`Map path must point to a JSON file: ${mapPath}`);
  }

  return absoluteMapPath;
}

function validateClassificationPayload(classification) {
  if (!classification || typeof classification !== 'object' || Array.isArray(classification)) {
    throw new Error('Classification payload must be an object.');
  }

  validateTypeRows(classification.rows);

  if (!classification.behaviorRows || typeof classification.behaviorRows !== 'object' || Array.isArray(classification.behaviorRows)) {
    throw new Error('Classification payload behaviorRows must be an object.');
  }

  for (const property of BEHAVIOR_LABEL_OPTIONS) {
    validateBehaviorRows(property, classification.behaviorRows[property]);
  }
}

function validateTypeRows(rows) {
  if (!Array.isArray(rows) || rows.length !== GRID_SIZE) {
    throw new Error(`Classification rows must contain ${GRID_SIZE} rows.`);
  }

  for (let y = 0; y < GRID_SIZE; y += 1) {
    const row = rows[y];

    if (!Array.isArray(row) || row.length !== GRID_SIZE) {
      throw new Error(`Classification row ${y} must contain ${GRID_SIZE} labels.`);
    }

    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!TYPE_LABEL_OPTIONS.includes(row[x])) {
        throw new Error(`Invalid tile type "${row[x]}" at ${x},${y}.`);
      }
    }
  }
}

function validateBehaviorRows(property, rows) {
  if (!Array.isArray(rows) || rows.length !== GRID_SIZE) {
    throw new Error(`Classification behaviorRows.${property} must contain ${GRID_SIZE} rows.`);
  }

  for (let y = 0; y < GRID_SIZE; y += 1) {
    const row = rows[y];

    if (!Array.isArray(row) || row.length !== GRID_SIZE) {
      throw new Error(`Classification behaviorRows.${property}[${y}] must contain ${GRID_SIZE} booleans.`);
    }

    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (typeof row[x] !== 'boolean') {
        throw new Error(`Classification behaviorRows.${property} has non-boolean value at ${x},${y}.`);
      }
    }
  }
}

function buildEpiCityMap(existingMap, typeRows, behaviorRows) {
  const definitionToSymbol = new Map();
  const legend = {};
  const rows = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    let row = '';

    for (let x = 0; x < GRID_SIZE; x += 1) {
      const type = typeRows[y][x];
      const definition = definitionForCell(type, {
        walkable: behaviorRows.walkable[y][x],
        drivable: behaviorRows.drivable[y][x],
        parkable: behaviorRows.parkable[y][x]
      });
      const key = JSON.stringify(definition);
      let symbol = definitionToSymbol.get(key);

      if (!symbol) {
        symbol = SAFE_SYMBOLS[definitionToSymbol.size];

        if (!symbol) {
          throw new Error('Not enough legend symbols for generated Epi City map.');
        }

        definitionToSymbol.set(key, symbol);
        legend[symbol] = definition;
      }

      row += symbol;
    }

    rows.push(row);
  }

  return {
    width: existingMap.width,
    height: existingMap.height,
    tileSize: existingMap.tileSize,
    textureSet: existingMap.textureSet,
    legend,
    rows,
    textureRows: existingMap.textureRows
  };
}

function definitionForCell(type, behavior) {
  const category = type === 'park' ? 'sidewalk' : type;
  const subcategory = DEFAULT_SUBCATEGORY_BY_TYPE[type];

  return {
    category,
    subcategory,
    walkable: Boolean(behavior.walkable),
    drivable: Boolean(behavior.drivable),
    parkable: Boolean(behavior.parkable)
  };
}

async function writeEpiCityMap(filePath, map) {
  const lines = [
    '{',
    `  "width": ${map.width},`,
    `  "height": ${map.height},`,
    `  "tileSize": ${map.tileSize},`,
    `  "textureSet": ${JSON.stringify(map.textureSet)},`,
    `  "legend": ${JSON.stringify(map.legend, null, 2).replace(/\n/g, '\n  ')},`,
    '  "rows": ['
  ];

  for (let index = 0; index < map.rows.length; index += 1) {
    const comma = index + 1 === map.rows.length ? '' : ',';
    lines.push(`    ${JSON.stringify(map.rows[index])}${comma}`);
  }

  lines.push('  ],');
  lines.push('  "textureRows": [');

  for (let index = 0; index < map.textureRows.length; index += 1) {
    const comma = index + 1 === map.textureRows.length ? '' : ',';
    lines.push(`    ${JSON.stringify(map.textureRows[index])}${comma}`);
  }

  lines.push('  ]');
  lines.push('}');
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  try {
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
      await sendFile(request, response, path.join(TOOL_DIR, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/source-image') {
      await sendFile(request, response, SOURCE_IMAGE_PATH, 'image/webp');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      sendJson(response, 200, {
        gridSize: GRID_SIZE,
        sourceImageUrl: '/source-image',
        labelsPath: path.relative(REPO_ROOT, LABELS_PATH),
        sourceImagePath: path.relative(REPO_ROOT, SOURCE_IMAGE_PATH),
        generatedMapPath: path.relative(REPO_ROOT, DEFAULT_MAP_PATH),
        defaultMapPath: path.relative(REPO_ROOT, DEFAULT_MAP_PATH),
        typeLabels: TYPE_LABEL_OPTIONS,
        behaviorLabels: BEHAVIOR_LABEL_OPTIONS
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/labels') {
      const labels = normalizeLabelsFile(await readJsonFile(LABELS_PATH, emptyLabelFile()));
      sendJson(response, 200, labels);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/labels') {
      const labels = normalizeLabelsFile(await readRequestJson(request));
      await mkdir(path.dirname(LABELS_PATH), { recursive: true });
      await writeFile(LABELS_PATH, JSON.stringify(labels, null, 2) + '\n', 'utf8');
      sendJson(response, 200, {
        ok: true,
        saved: countLabels(labels),
        path: path.relative(REPO_ROOT, LABELS_PATH)
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/current-classification') {
      sendJson(response, 200, await loadCurrentClassification(url.searchParams.get('path') || undefined));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/epi-city-map') {
      sendJson(response, 200, await loadCurrentClassification(url.searchParams.get('path') || undefined));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/epi-city-map') {
      const result = await saveEpiCityMap(await readRequestJson(request));
      sendJson(response, 200, {
        ok: true,
        path: result.path,
        ...result.classification
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/train') {
      const options = (await readRequestJson(request)) || {};
      const labels = normalizeLabelsFile(await readJsonFile(LABELS_PATH, emptyLabelFile()));
      const prediction = await runTrainer(
        Number.isInteger(options.trees) ? options.trees : 48,
        options.mapPath || labels.generatedMap || path.relative(REPO_ROOT, DEFAULT_MAP_PATH)
      );
      sendJson(response, 200, {
        ...prediction,
        savedLabels: countLabels(labels)
      });
      return;
    }

    sendError(response, 404, `Unknown route ${request.method} ${url.pathname}`);
  } catch (error) {
    console.error(error);
    sendError(response, 500, error.message);
  }
}

function runTrainer(trees, mapPath) {
  const absoluteMapPath = resolveMapPath(mapPath);
  const pythonPath = trainerPythonPath();

  return new Promise((resolve, reject) => {
    const process = spawn(pythonPath, [
      TRAINER_PATH,
      '--source',
      SOURCE_IMAGE_PATH,
      '--map',
      absoluteMapPath,
      '--labels',
      LABELS_PATH,
      '--grid-size',
      String(GRID_SIZE),
      '--trees',
      String(Math.max(1, Math.min(128, trees)))
    ], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdout = [];
    const stderr = [];

    process.stdout.on('data', (chunk) => stdout.push(chunk));
    process.stderr.on('data', (chunk) => stderr.push(chunk));

    process.on('error', reject);
    process.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      const errors = Buffer.concat(stderr).toString('utf8');

      if (code !== 0) {
        reject(new Error(`Random forest trainer exited with ${code}: ${errors || output}`));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(new Error(`Random forest trainer returned invalid JSON: ${error.message}\n${output}\n${errors}`));
      }
    });
  });
}

function trainerPythonPath() {
  return process.env.MAP_EDITOR_PYTHON || (existsSync(VENV_PYTHON_PATH) ? VENV_PYTHON_PATH : 'python3');
}

function displayPath(filePath) {
  return path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath;
}

function countLabels(labels) {
  const behavior = Object.fromEntries(BEHAVIOR_LABEL_OPTIONS.map((property) => [property, labels.behaviorLabels[property].length]));
  const total = labels.typeLabels.length + Object.values(behavior).reduce((sum, count) => sum + count, 0);

  return {
    total,
    typeLabels: labels.typeLabels.length,
    behaviorLabels: behavior
  };
}

createServer(handleRequest).listen(PORT, '0.0.0.0', () => {
  console.log(`Map editor running at http://localhost:${PORT}`);
  console.log(`Labels save to ${path.relative(REPO_ROOT, LABELS_PATH)}`);
  console.log(`Training Python: ${displayPath(trainerPythonPath())}`);
});
