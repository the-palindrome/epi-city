#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const VENV_DIR = path.join(TOOL_DIR, '.venv');
const REQUIREMENTS_PATH = path.join(TOOL_DIR, 'requirements.txt');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python');

let bootstrapPython = null;

if (!existsSync(VENV_PYTHON)) {
  bootstrapPython = requireBootstrapPython();
  recreateVenv('No usable map-editor virtualenv was found.');
} else if (!isUsablePython(VENV_PYTHON)) {
  bootstrapPython = requireBootstrapPython();
  recreateVenv('The existing map-editor virtualenv is not usable with Python 3.10+.');
}

if (!existsSync(REQUIREMENTS_PATH)) {
  fail(`Missing requirements file: ${displayPath(REQUIREMENTS_PATH)}`);
}

run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQUIREMENTS_PATH]);
console.log(`Map editor Python environment is ready at ${displayPath(VENV_DIR)}`);

function recreateVenv(reason) {
  console.log(`${reason} Recreating ${displayPath(VENV_DIR)}...`);
  removeVenv();

  const result = spawnSync(bootstrapPython, ['-m', 'venv', '--copies', VENV_DIR], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    fail([
      `Failed to create ${displayPath(VENV_DIR)} with ${bootstrapPython}.`,
      'On Debian/Ubuntu, install the venv package for your Python version, then retry:',
      '  sudo apt install python3-venv',
      'You can also choose another interpreter:',
      '  MAP_EDITOR_BOOTSTRAP_PYTHON=/path/to/python npm run map-editor:deps'
    ].join('\n'));
  }

  if (!existsSync(VENV_PYTHON)) {
    fail(`Created ${displayPath(VENV_DIR)}, but ${displayPath(VENV_PYTHON)} is still missing.`);
  }
}

function removeVenv() {
  const relative = path.relative(TOOL_DIR, VENV_DIR);

  if (relative !== '.venv') {
    fail(`Refusing to remove unexpected virtualenv path: ${VENV_DIR}`);
  }

  rmSync(VENV_DIR, { recursive: true, force: true });
}

function findBootstrapPython() {
  const candidates = [
    process.env.MAP_EDITOR_BOOTSTRAP_PYTHON,
    process.env.PYTHON,
    'python3',
    'python'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isUsablePython(candidate)) {
      return candidate;
    }
  }

  return null;
}

function requireBootstrapPython() {
  const python = findBootstrapPython();

  if (!python) {
    fail('Could not find Python. Install Python 3, or set MAP_EDITOR_BOOTSTRAP_PYTHON=/path/to/python.');
  }

  return python;
}

function isUsablePython(command) {
  const result = spawnSync(command, ['-c', 'import ensurepip, sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });

  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    const reason = result.error ? ` (${result.error.message})` : '';
    fail(`Command failed${reason}: ${[displayPath(command), ...args].join(' ')}`);
  }
}

function displayPath(filePath) {
  return path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
