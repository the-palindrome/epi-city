const UINT32_RANGE = 0x100000000
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function createSeededRandom(seed) {
  let state = hashSeed(String(seed))

  return createRandomSource({
    next() {
      state = (state + 0x6d2b79f5) >>> 0

      let value = state

      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

      return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE
    },
    seed: String(seed)
  })
}

export function createSystemRandom() {
  return createRandomSource({
    next: Math.random,
    seed: null
  })
}

function createRandomSource({ next, seed }) {
  return {
    seed,
    next,
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('Random integer max must be a positive integer.')
      }

      return Math.floor(next() * maxExclusive)
    },
    between(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        throw new Error('Random range must have finite min and max values with max >= min.')
      }

      return min + next() * (max - min)
    }
  }
}

function hashSeed(seed) {
  let hash = FNV_OFFSET_BASIS

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }

  return hash >>> 0
}
