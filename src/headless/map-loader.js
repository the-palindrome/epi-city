import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileCityMap,
  validateCityMap
} from '../map/city-map.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')
const DEFAULT_MAP_DIR = path.resolve(projectRoot, 'public', 'maps', 'liberty-city')

export async function loadDefaultHeadlessCity() {
  const tileLayoutPath = path.join(DEFAULT_MAP_DIR, 'tile-layout.json')
  const textureLayoutPath = path.join(DEFAULT_MAP_DIR, 'texture-layout.json')
  const [tileLayout, textureLayout] = await Promise.all([
    readJson(tileLayoutPath, 'tile layout'),
    readJson(textureLayoutPath, 'texture layout')
  ])

  return compileCityMap(validateCityMap({
    ...tileLayout,
    textureSet: textureLayout.textureSet || tileLayout.textureSet,
    textureRows: textureLayout.textureRows
  }))
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to load ${label} from ${filePath}: ${error.message}`)
  }
}
