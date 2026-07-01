import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileCityMap,
  validateCityMap
} from '../map/city-map.js'
import {
  createHeadlessRouteFieldStore,
  createMapFilesFingerprint
} from './route-field-cache.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const DEFAULT_MAP_DIR = path.resolve(projectRoot, 'public', 'maps', 'liberty-city')
const HEADLESS_CACHE_DIR = path.resolve(projectRoot, 'tmp', 'headless-map-cache')
const HEADLESS_ROUTE_FIELD_CACHE_LIMIT = 2048

export async function loadDefaultHeadlessCity() {
  const tileLayoutPath = path.join(DEFAULT_MAP_DIR, 'tile-layout.json')
  const textureLayoutPath = path.join(DEFAULT_MAP_DIR, 'texture-layout.json')
  const [tileLayoutFile, textureLayoutFile] = await Promise.all([
    readJsonFile(tileLayoutPath, 'tile layout'),
    readJsonFile(textureLayoutPath, 'texture layout')
  ])
  const tileLayout = tileLayoutFile.json
  const textureLayout = textureLayoutFile.json
  const mapFingerprint = createMapFilesFingerprint([tileLayoutFile, textureLayoutFile])

  const city = compileCityMap(validateCityMap({
    ...tileLayout,
    textureSet: textureLayout.textureSet || tileLayout.textureSet,
    textureRows: textureLayout.textureRows
  }))

  city.setRouteFieldCacheLimit?.(HEADLESS_ROUTE_FIELD_CACHE_LIMIT)
  city.setRouteFieldPersistentStore?.(createHeadlessRouteFieldStore({
    cacheRoot: HEADLESS_CACHE_DIR,
    namespace: `${mapFingerprint}-${city.navigationCacheKey}`
  }))

  return city
}

async function readJsonFile(filePath, label) {
  try {
    const text = await fs.readFile(filePath, 'utf8')

    return {
      path: filePath,
      text,
      json: JSON.parse(text)
    }
  } catch (error) {
    throw new Error(`Unable to load ${label} from ${filePath}: ${error.message}`)
  }
}
