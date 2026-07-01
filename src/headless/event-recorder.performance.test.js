import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { HeadlessEventRecorder } from './event-recorder.js'

const CONTACT_PAIR_KEY_BASE = 0x4000000

function createCity() {
  return {
    tileSize: 32,
    inBounds: (x, y) => x >= 0 && y >= 0 && x < 256 && y < 256,
    index: (x, y) => y * 256 + x
  }
}

function createSameTileNpcs(count) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    position: {
      x: 16 + (id % 4),
      y: 16 + Math.floor((id % 16) / 4)
    },
    tile: { x: 0, y: 0, index: 0 }
  }))
}

function measureBest(fn, attempts = 5) {
  fn()

  let best = Infinity

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const start = performance.now()

    fn()
    best = Math.min(best, performance.now() - start)
  }

  return best
}

function recordMeasurement(label, ms) {
  process.stdout.write(`[perf] ${label}: ${ms.toFixed(3)}ms\n`)
}

describe('headless event recorder performance', () => {
  it('profiles repeated contact observation recording', () => {
    const city = createCity()
    const npcs = createSameTileNpcs(200)
    const pairs = createContactPairs(npcs)
    const repetitions = 2000

    let eventCount = 0
    const optimizedMs = measureBest(() => {
      const recorder = new HeadlessEventRecorder({ city })

      recordContactPairs(pairs, repetitions, (pair, at) => {
        recorder.recordOrderedContactObservationSquared(
          pair.firstNpc,
          pair.secondNpc,
          pair.firstNpc.id,
          pair.secondNpc.id,
          pair.key,
          pair.distanceSquared,
          at
        )
      })
      recorder.flushContacts(999)
      eventCount = recorder.events.length
    })

    expect(eventCount).toBe(pairs.length)
    expect(Number.isFinite(optimizedMs)).toBe(true)
    recordMeasurement('headless contact observation recording', optimizedMs)
  }, 30000)
})

function createContactPairs(npcs) {
  const pairs = []

  for (let index = 1; index < npcs.length; index += 1) {
    const firstNpc = npcs[index - 1]
    const secondNpc = npcs[index]
    const dx = secondNpc.position.x - firstNpc.position.x
    const dy = secondNpc.position.y - firstNpc.position.y
    const distanceSquared = dx * dx + dy * dy

    pairs.push({
      firstNpc,
      secondNpc,
      distanceSquared,
      key: firstNpc.id * CONTACT_PAIR_KEY_BASE + secondNpc.id
    })
  }

  return pairs
}

function recordContactPairs(pairs, repetitions, record) {
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const at = repetition * 2

    for (let index = 0; index < pairs.length; index += 1) {
      record(pairs[index], at)
    }
  }
}
