import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const HEADLESS_ROUTE_FIELD_CACHE_VERSION = 1

export function createHeadlessRouteFieldStore({ cacheRoot, namespace }) {
  const cacheDir = path.join(cacheRoot, `v${HEADLESS_ROUTE_FIELD_CACHE_VERSION}`, safePathPart(namespace))
  const pendingWrites = new Map()
  const stats = {
    hits: 0,
    misses: 0,
    writes: 0,
    errors: 0
  }

  let enabled = true

  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch {
    enabled = false
  }

  return {
    get cacheDir() {
      return cacheDir
    },
    get stats() {
      return { ...stats, pendingWrites: pendingWrites.size }
    },
    get(fieldKey, length, offsets) {
      if (!enabled) {
        stats.misses += 1
        return null
      }

      const filePath = routeFieldPath(cacheDir, fieldKey)

      if (!fs.existsSync(filePath)) {
        stats.misses += 1
        return null
      }

      try {
        const buffer = fs.readFileSync(filePath)

        if (buffer.byteLength !== length) {
          stats.misses += 1
          return null
        }

        const nextDirection = new Uint8Array(buffer)

        stats.hits += 1
        return {
          nextDirection,
          nextIndex: buildNextIndexFromDirections(nextDirection, offsets),
          pathsByStart: new Map()
        }
      } catch {
        stats.misses += 1
        stats.errors += 1
        return null
      }
    },
    put(fieldKey, field) {
      if (!enabled || !(field?.nextDirection instanceof Uint8Array)) {
        return
      }

      pendingWrites.set(routeFieldPath(cacheDir, fieldKey), field.nextDirection.slice())
    },
    flush() {
      if (pendingWrites.size === 0) {
        return
      }

      if (!enabled) {
        pendingWrites.clear()
        return
      }

      for (const [filePath, nextDirection] of pendingWrites.entries()) {
        const temporaryPath = `${filePath}.tmp`

        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(temporaryPath, Buffer.from(nextDirection))
          fs.renameSync(temporaryPath, filePath)
          stats.writes += 1
        } catch {
          stats.errors += 1
        }
      }

      pendingWrites.clear()
    }
  }
}

export function createMapFilesFingerprint(files) {
  const hash = createHash('sha256')

  for (const file of files) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.text)
    hash.update('\0')
  }

  return hash.digest('hex').slice(0, 24)
}

function routeFieldPath(cacheDir, fieldKey) {
  return path.join(cacheDir, `${hashFieldKey(fieldKey)}.bin`)
}

function hashFieldKey(fieldKey) {
  return createHash('sha1').update(String(fieldKey)).digest('hex')
}

function safePathPart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function buildNextIndexFromDirections(nextDirection, offsets) {
  const nextIndex = new Int32Array(nextDirection.length)

  nextIndex.fill(-1)

  for (let index = 0; index < nextDirection.length; index += 1) {
    const direction = nextDirection[index]

    if (direction <= 7) {
      nextIndex[index] = index + offsets[direction]
    }
  }

  return nextIndex
}
