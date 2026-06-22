import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { worldUnitsToMeters } from '../core/scale.js'
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

describe('headless event recorder performance', () => {
  it('records repeated contact observations at least 10x faster than the legacy object-heavy path', () => {
    const city = createCity()
    const npcs = createSameTileNpcs(200)
    const pairs = createContactPairs(npcs)
    const repetitions = 2000

    const legacyMs = measureBest(() => {
      const recorder = new LegacyContactRecorder(city)

      recordContactPairs(pairs, repetitions, (pair, at) => {
        recorder.recordContactObservation(pair.firstNpc, pair.secondNpc, pair.distance, at)
      })
      recorder.flushContacts(999)
    })

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
    })
    const speedup = legacyMs / Math.max(optimizedMs, 0.001)

    expect(speedup).toBeGreaterThanOrEqual(10)
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
      distance: Math.sqrt(distanceSquared),
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

class LegacyContactRecorder {
  constructor(city) {
    this.city = city
    this.events = []
    this.activeContacts = new Map()
    this.sequence = 0
    this.counts = { contact: 0 }
  }

  recordContactObservation(firstNpc, secondNpc, distanceWorldUnits, at) {
    const pair = orderedNpcIds(firstNpc, secondNpc)
    const key = pair.join(':')
    const distanceMeters = legacyRoundMetric(worldUnitsToMeters(distanceWorldUnits))
    let contact = this.activeContacts.get(key)

    if (!contact) {
      contact = {
        event: 'contact',
        id: this.nextId('contact'),
        npcs: pair.map(formatNpcId),
        at,
        until: at,
        durationSeconds: 0,
        where: legacyWhereBetween(this.city, firstNpc, secondNpc),
        minDistanceMeters: distanceMeters,
        observationCount: 0,
        order: this.nextOrder()
      }
      this.activeContacts.set(key, contact)
    }

    contact.until = at
    contact.durationSeconds = Math.max(0, contact.until - contact.at)
    contact.minDistanceMeters = Math.min(contact.minDistanceMeters, distanceMeters)
    contact.observationCount += 1
    contact.lastObservedAt = at
    contact.where = legacyWhereBetween(this.city, firstNpc, secondNpc)
  }

  flushContacts(at) {
    for (const [key, contact] of this.activeContacts.entries()) {
      contact.until = Math.max(contact.until, at)
      contact.durationSeconds = Math.max(0, contact.until - contact.at)
      this.events.push(contact)
      this.activeContacts.delete(key)
    }
  }

  nextId(kind) {
    this.counts[kind] = (this.counts[kind] || 0) + 1
    return `${kind}_${this.counts[kind]}`
  }

  nextOrder() {
    this.sequence += 1
    return this.sequence
  }
}

function orderedNpcIds(firstNpc, secondNpc) {
  const firstId = Number(firstNpc?.id)
  const secondId = Number(secondNpc?.id)

  return firstId <= secondId ? [firstId, secondId] : [secondId, firstId]
}

function formatNpcId(id) {
  return `npc_${id}`
}

function legacyWhereBetween(city, firstNpc, secondNpc) {
  const midpoint = {
    x: ((Number(firstNpc?.position?.x) || 0) + (Number(secondNpc?.position?.x) || 0)) / 2,
    y: ((Number(firstNpc?.position?.y) || 0) + (Number(secondNpc?.position?.y) || 0)) / 2
  }
  const x = Math.floor(midpoint.x / city.tileSize)
  const y = Math.floor(midpoint.y / city.tileSize)

  return {
    tile: city.inBounds(x, y)
      ? { x, y, index: city.index(x, y) }
      : { ...firstNpc.tile }
  }
}

function legacyRoundMetric(value) {
  return Number(Number(value).toFixed(4))
}
