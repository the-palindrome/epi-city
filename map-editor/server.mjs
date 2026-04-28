#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const TRAINER_PATH = path.join(TOOL_DIR, 'train_random_forest.py');
const VENV_PYTHON_PATH = process.platform === 'win32'
  ? path.join(TOOL_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(TOOL_DIR, '.venv', 'bin', 'python');
const SOURCE_IMAGE_PATH = path.join(REPO_ROOT, 'process_gta_map/source/gta1-liberty-city-hd.webp');
const PORT = Number(process.env.PORT || 5174);
const GRID_SIZE = 256;
const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;
const MAX_TRAINER_OUTPUT_BYTES = 5 * 1024 * 1024;

const TYPE_LABEL_OPTIONS = Object.freeze(['road', 'sidewalk', 'park', 'water', 'bridge', 'building']);
const BEHAVIOR_LABEL_OPTIONS = Object.freeze(['walkable', 'parkable', 'drivable']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

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

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, `JSON request body must be ${MAX_JSON_BODY_BYTES} bytes or smaller.`);
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new HttpError(400, `Invalid JSON request body: ${error.message}`);
  }
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
      const value = row[x];

      if (!isEmptyLabelValue(value) && !TYPE_LABEL_OPTIONS.includes(value)) {
        throw new Error(`Invalid tile type "${value}" at ${x},${y}.`);
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
      const value = row[x];

      if (!isEmptyLabelValue(value) && typeof value !== 'boolean') {
        throw new Error(`Classification behaviorRows.${property} has non-boolean/non-empty value at ${x},${y}.`);
      }
    }
  }
}

function isEmptyLabelValue(value) {
  return value === null || value === '';
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
        sourceImagePath: path.relative(REPO_ROOT, SOURCE_IMAGE_PATH),
        typeLabels: TYPE_LABEL_OPTIONS,
        behaviorLabels: BEHAVIOR_LABEL_OPTIONS
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/labels') {
      sendError(response, 410, 'Sparse label files are deprecated. Keep labels in the browser state and POST rows/behaviorRows to /api/train.');
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/labels') {
      sendError(response, 410, 'Sparse label file writes are deprecated. Keep labels in the browser state and POST rows/behaviorRows to /api/train.');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/current-classification') {
      sendError(response, 410, 'Server-side map loading is deprecated. Use the Load JSON button to load a local map file into the browser state.');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/epi-city-map') {
      sendError(response, 410, 'Server-side map loading is deprecated. Use the Load JSON button to load a local map file into the browser state.');
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/epi-city-map') {
      sendError(response, 410, 'Server-side map JSON writes are deprecated. Save the current map as a downloaded JSON file from the browser.');
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/train') {
      const options = (await readRequestJson(request)) || {};
      validateTrainOptions(options);
      const prediction = await runTrainer(
        Number.isInteger(options.trees) ? options.trees : 48,
        {
          rows: options.rows,
          behaviorRows: options.behaviorRows
        }
      );
      sendJson(response, 200, prediction);
      return;
    }

    sendError(response, 404, `Unknown route ${request.method} ${url.pathname}`);
  } catch (error) {
    const status = error.status || 500;

    if (status >= 500) {
      console.error(error);
    }

    sendError(response, status, error.message);
  }
}

function validateTrainOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new HttpError(400, 'Train options must be an object.');
  }

  if (options.trees !== undefined && (!Number.isInteger(options.trees) || options.trees < 1 || options.trees > 128)) {
    throw new HttpError(400, 'Train option trees must be an integer from 1 to 128.');
  }

  if (!hasPostedState(options)) {
    throw new HttpError(400, 'Train requires rows and behaviorRows from the current editor state.');
  }

  try {
    validateClassificationPayload(options);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

function hasPostedState(options) {
  return options.rows !== undefined && options.behaviorRows !== undefined;
}

function runTrainer(trees, state) {
  const pythonPath = trainerPythonPath();

  return new Promise((resolve, reject) => {
    const process = spawn(pythonPath, [
      TRAINER_PATH,
      '--source',
      SOURCE_IMAGE_PATH,
      '--state',
      '-',
      '--grid-size',
      String(GRID_SIZE),
      '--trees',
      String(Math.max(1, Math.min(128, trees)))
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdout = [];
    const stderr = [];

    process.stdout.on('data', (chunk) => pushLimitedOutput(stdout, chunk));
    process.stderr.on('data', (chunk) => pushLimitedOutput(stderr, chunk));
    process.stdin.end(JSON.stringify(state));

    process.on('error', (error) => {
      reject(new Error(`Could not start random forest trainer with ${displayPath(pythonPath)}: ${error.message}`));
    });
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

function pushLimitedOutput(chunks, chunk) {
  const currentSize = chunks.reduce((sum, item) => sum + item.length, 0);

  if (currentSize < MAX_TRAINER_OUTPUT_BYTES) {
    chunks.push(chunk.subarray(0, Math.max(0, MAX_TRAINER_OUTPUT_BYTES - currentSize)));
  }
}

function trainerPythonPath() {
  return process.env.MAP_EDITOR_PYTHON || (existsSync(VENV_PYTHON_PATH) ? VENV_PYTHON_PATH : 'python3');
}

function displayPath(filePath) {
  return path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath;
}

createServer(handleRequest).listen(PORT, '0.0.0.0', () => {
  console.log(`Map editor running at http://localhost:${PORT}`);
  console.log('Map state loads/saves in the browser; /api/train accepts posted rows/behaviorRows.');
  console.log(`Training Python: ${displayPath(trainerPythonPath())}`);
});
