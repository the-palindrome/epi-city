import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function loadLibertyCityMap() {
  return JSON.parse(readFileSync(path.join(ROOT, 'public/maps/liberty-city/tile-layout.json'), 'utf8'))
}

function isRoadOrCrosswalk(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return false
  }

  const entry = map.legend[map.rows[y][x]]
  return Boolean(entry && (entry.category === 'road' || entry.category === 'crosswalk'))
}

describe('lane graph map layout', () => {
  it('ships Liberty City without generated lane graph metadata', () => {
    const map = loadLibertyCityMap()

    expect(map.laneGraph).toBeUndefined()
  })

  it('keeps road and crosswalk tiles available for manual lane graph authoring', () => {
    const map = loadLibertyCityMap()
    let roadOrCrosswalkTiles = 0
    let crosswalkTiles = 0

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (isRoadOrCrosswalk(map, x, y)) {
          roadOrCrosswalkTiles += 1
        }

        if (map.legend[map.rows[y][x]].category === 'crosswalk') {
          crosswalkTiles += 1
        }
      }
    }

    expect(roadOrCrosswalkTiles).toBeGreaterThan(0)
    expect(crosswalkTiles).toBeGreaterThan(0)
  })
})
