import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHeadlessRouteFieldStore,
  createMapFilesFingerprint
} from './route-field-cache.js'

describe('headless route field cache', () => {
  it('round-trips compact route field directions into route next indexes', () => {
    const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'epi-city-route-cache-'))
    const offsets = [1, -1, 4, -4, 5, -3, 3, -5]

    try {
      const writer = createHeadlessRouteFieldStore({
        cacheRoot,
        namespace: 'test-map'
      })
      const nextDirection = new Uint8Array([0, 2, 254, 255, 7])

      writer.put('walkable:red:2', {
        nextDirection,
        nextIndex: new Int32Array(nextDirection.length),
        pathsByStart: new Map()
      })
      writer.flush()

      const reader = createHeadlessRouteFieldStore({
        cacheRoot,
        namespace: 'test-map'
      })
      const field = reader.get('walkable:red:2', nextDirection.length, offsets)

      expect(Array.from(field.nextDirection)).toEqual([0, 2, 254, 255, 7])
      expect(Array.from(field.nextIndex)).toEqual([1, 5, -1, -1, -1])
      expect(reader.stats.hits).toBe(1)
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true })
    }
  })

  it('fingerprints map file contents and paths', () => {
    const first = createMapFilesFingerprint([
      { path: 'a.json', text: '{"width":1}' },
      { path: 'b.json', text: '{"textureRows":[]}' }
    ])
    const second = createMapFilesFingerprint([
      { path: 'a.json', text: '{"width":2}' },
      { path: 'b.json', text: '{"textureRows":[]}' }
    ])

    expect(first).not.toBe(second)
    expect(first).toHaveLength(24)
  })
})
