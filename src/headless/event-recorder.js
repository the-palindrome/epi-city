import { METERS_PER_WORLD_UNIT, worldUnitsToMeters } from '../core/scale.js'

const CONTACT_PAIR_KEY_BASE = 0x4000000

export class HeadlessEventRecorder {
  constructor({ city, clock }) {
    this.city = city
    this.clock = clock
    this.events = []
    this.activeContacts = new Map()
    this.observationAt = NaN
    this.observedContactCount = 0
    this.sequence = 0
    this.counts = {
      contact: 0,
      infection: 0,
      incubation: 0,
      recovery: 0,
      immunity_waned: 0,
      policy: 0
    }
  }

  recordContactObservation(firstNpc, secondNpc, distanceWorldUnits, at = this.getAt()) {
    return this.recordContactObservationSquared(
      firstNpc,
      secondNpc,
      Number(distanceWorldUnits) * Number(distanceWorldUnits),
      at
    )
  }

  recordContactObservationSquared(firstNpc, secondNpc, distanceWorldUnitsSquared, at = this.getAt()) {
    const pair = orderedNpcPair(firstNpc, secondNpc)
    return this.recordOrderedContactObservationSquared(
      firstNpc,
      secondNpc,
      pair.firstId,
      pair.secondId,
      pair.key,
      distanceWorldUnitsSquared,
      at
    )
  }

  recordOrderedContactObservationSquared(
    firstNpc,
    secondNpc,
    firstNpcId,
    secondNpcId,
    pairKey,
    distanceWorldUnitsSquared,
    at = this.getAt()
  ) {
    const rawDistanceSquared = Number(distanceWorldUnitsSquared)
    const distanceSquared = Number.isFinite(rawDistanceSquared) && rawDistanceSquared >= 0
      ? rawDistanceSquared
      : 0
    let contact = this.activeContacts.get(pairKey)

    if (!contact) {
      contact = {
        event: 'contact',
        id: this.nextId('contact'),
        npcs: [formatNpcId(firstNpcId), formatNpcId(secondNpcId)],
        at,
        until: at,
        durationSeconds: 0,
        minDistanceWorldUnitsSquared: distanceSquared,
        observationCount: 0,
        order: this.nextOrder()
      }
      setContactTileBetween(contact, this.city, firstNpc, secondNpc)
      this.activeContacts.set(pairKey, contact)
    }

    this.markContactObserved(contact, at)
    contact.until = at
    contact.durationSeconds = contact.until - contact.at
    if (distanceSquared < contact.minDistanceWorldUnitsSquared) {
      contact.minDistanceWorldUnitsSquared = distanceSquared
    }
    contact.observationCount += 1
    contact.lastObservedAt = at
    if (!isSameUnchangedTile(contact, firstNpc, secondNpc)) {
      setContactTileBetween(contact, this.city, firstNpc, secondNpc)
    }
  }

  recordOrderedSameTileContactObservation(
    firstNpcId,
    secondNpcId,
    pairKey,
    tile,
    at = this.getAt()
  ) {
    let contact = this.activeContacts.get(pairKey)

    if (!contact) {
      contact = {
        event: 'contact',
        id: this.nextId('contact'),
        npcs: [formatNpcId(firstNpcId), formatNpcId(secondNpcId)],
        at,
        until: at,
        durationSeconds: 0,
        minDistanceWorldUnitsSquared: 0,
        observationCount: 0,
        order: this.nextOrder()
      }
      setContactTile(contact, tile)
      this.activeContacts.set(pairKey, contact)
    } else if (contact.tileIndex !== tile?.index) {
      setContactTile(contact, tile)
    }

    this.markContactObserved(contact, at)
    contact.until = at
    contact.durationSeconds = contact.until - contact.at
    if (contact.minDistanceWorldUnitsSquared > 0) {
      contact.minDistanceWorldUnitsSquared = 0
    }
    contact.observationCount += 1
    contact.lastObservedAt = at
  }

  closeInactiveContacts(at = this.getAt()) {
    if (
      this.activeContacts.size === 0 ||
      (
        this.observationAt === at &&
        this.observedContactCount >= this.activeContacts.size
      )
    ) {
      return
    }

    for (const [key, contact] of this.activeContacts.entries()) {
      if (contact.lastObservedAt >= at) {
        continue
      }

      contact.until = at
      contact.durationSeconds = Math.max(0, contact.until - contact.at)
      this.pushEvent(cleanContactEvent(contact))
      this.activeContacts.delete(key)
    }
  }

  flushContacts(at = this.getAt()) {
    for (const [key, contact] of this.activeContacts.entries()) {
      contact.until = Math.max(contact.until, at)
      contact.durationSeconds = Math.max(0, contact.until - contact.at)
      this.pushEvent(cleanContactEvent(contact))
      this.activeContacts.delete(key)
    }
  }

  recordInfection({ sourceNpc, targetNpc, distanceWorldUnits, at = this.getAt() }) {
    const event = {
      event: 'infection',
      id: this.nextId('infection'),
      from: formatNpcId(sourceNpc.id),
      to: formatNpcId(targetNpc.id),
      at,
      where: this.whereBetween(sourceNpc, targetNpc),
      distanceMeters: roundMetric(worldUnitsToMeters(distanceWorldUnits)),
      order: this.nextOrder()
    }

    this.pushEvent(event)
    return event.id
  }

  recordIncubation(npc, at = this.getAt()) {
    return this.recordNpcPhaseEvent('incubation', npc, at)
  }

  recordRecovery(npc, at = this.getAt()) {
    return this.recordNpcPhaseEvent('recovery', npc, at)
  }

  recordImmunityWaned(npc, at = this.getAt()) {
    return this.recordNpcPhaseEvent('immunity_waned', npc, at)
  }

  recordPolicyEffectChange(effects, at = this.getAt()) {
    this.pushEvent({
      event: 'policy_effect_change',
      id: this.nextId('policy'),
      at,
      activePolicyIds: (effects.activePolicies || []).map((policy) => policy.id),
      effects: clonePolicyEffects(effects),
      order: this.nextOrder()
    })
  }

  getEvents() {
    return this.events
      .slice()
      .sort((left, right) => left.at - right.at || left.order - right.order)
      .map(stripOrder)
  }

  getAt() {
    if (this.clock && typeof this.clock.getElapsedSimulationSeconds === 'function') {
      const at = this.clock.getElapsedSimulationSeconds()

      if (Number.isFinite(at)) {
        return at
      }
    }

    return 0
  }

  recordNpcPhaseEvent(eventName, npc, at) {
    const event = {
      event: eventName,
      id: this.nextId(eventName),
      npc: formatNpcId(npc.id),
      at,
      where: this.whereAt(npc),
      order: this.nextOrder()
    }

    this.pushEvent(event)
    return event.id
  }

  pushEvent(event) {
    this.events.push(event)
  }

  markContactObserved(contact, at) {
    if (this.observationAt !== at) {
      this.observationAt = at
      this.observedContactCount = 0
    }

    if (contact.lastObservedAt !== at) {
      this.observedContactCount += 1
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

  whereAt(entity) {
    return {
      tile: cloneTile(entity?.tile)
    }
  }

  whereBetween(firstNpc, secondNpc) {
    const midpoint = {
      x: ((Number(firstNpc?.position?.x) || 0) + (Number(secondNpc?.position?.x) || 0)) / 2,
      y: ((Number(firstNpc?.position?.y) || 0) + (Number(secondNpc?.position?.y) || 0)) / 2
    }

    return {
      tile: tileForPosition(this.city, midpoint) || cloneTile(firstNpc?.tile) || cloneTile(secondNpc?.tile)
    }
  }
}

export function formatNpcId(id) {
  if (typeof id === 'string' && id.startsWith('npc_')) {
    return id
  }

  return `npc_${id}`
}

export function parseNpcId(id) {
  if (typeof id === 'number' && Number.isInteger(id)) {
    return id
  }

  const match = String(id || '').match(/^npc_(\d+)$/)

  return match ? Number(match[1]) : NaN
}

export function formatCarId(id) {
  if (typeof id === 'string' && id.startsWith('car_')) {
    return id
  }

  return `car_${id}`
}

function orderedNpcPair(firstNpc, secondNpc) {
  const firstId = Number(firstNpc?.id)
  const secondId = Number(secondNpc?.id)
  const orderedFirstId = firstId <= secondId ? firstId : secondId
  const orderedSecondId = firstId <= secondId ? secondId : firstId
  const numericKey = orderedFirstId * CONTACT_PAIR_KEY_BASE + orderedSecondId

  return {
    firstId: orderedFirstId,
    secondId: orderedSecondId,
    key: Number.isSafeInteger(numericKey)
      ? numericKey
      : `${orderedFirstId}:${orderedSecondId}`
  }
}

function cleanContactEvent(contact) {
  const {
    lastObservedAt,
    minDistanceWorldUnitsSquared,
    tileX,
    tileY,
    tileIndex,
    ...event
  } = contact

  return {
    ...event,
    minDistanceMeters: roundMetric(Math.sqrt(minDistanceWorldUnitsSquared) * METERS_PER_WORLD_UNIT),
    where: {
      tile: Number.isInteger(tileIndex)
        ? { x: tileX, y: tileY, index: tileIndex }
        : null
    }
  }
}

function stripOrder(event) {
  const { order, ...publicEvent } = event

  return publicEvent
}

function clonePolicyEffects(effects = {}) {
  return {
    infectionProbabilityMultiplier: Number(effects.infectionProbabilityMultiplier) || 0,
    socialDistancingEnabled: Boolean(effects.socialDistancingEnabled),
    eventCancellationProbabilities: {
      closeSchools: Number(effects.eventCancellationProbabilities?.closeSchools) || 0,
      homeOffice: Number(effects.eventCancellationProbabilities?.homeOffice) || 0,
      reduceShopping: Number(effects.eventCancellationProbabilities?.reduceShopping) || 0,
      reduceNightlife: Number(effects.eventCancellationProbabilities?.reduceNightlife) || 0
    }
  }
}

function cloneTile(tile) {
  if (!tile) {
    return null
  }

  return {
    x: tile.x,
    y: tile.y,
    index: tile.index
  }
}

function tileForPosition(city, position) {
  if (!city || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null
  }

  const x = Math.floor(position.x / city.tileSize)
  const y = Math.floor(position.y / city.tileSize)

  if (!city.inBounds?.(x, y)) {
    return null
  }

  return {
    x,
    y,
    index: city.index(x, y)
  }
}

function setContactTileBetween(contact, city, firstNpc, secondNpc) {
  const firstTile = firstNpc?.tile
  const secondTile = secondNpc?.tile

  if (firstTile && firstTile.index === secondTile?.index) {
    if (contact.tileIndex !== firstTile.index) {
      contact.tileX = firstTile.x
      contact.tileY = firstTile.y
      contact.tileIndex = firstTile.index
    }
    return
  }

  if (!city) {
    setContactTile(contact, cloneTile(firstTile) || cloneTile(secondTile))
    return
  }

  const midpointX = ((Number(firstNpc?.position?.x) || 0) + (Number(secondNpc?.position?.x) || 0)) / 2
  const midpointY = ((Number(firstNpc?.position?.y) || 0) + (Number(secondNpc?.position?.y) || 0)) / 2

  if (Number.isFinite(midpointX) && Number.isFinite(midpointY)) {
    const x = Math.floor(midpointX / city.tileSize)
    const y = Math.floor(midpointY / city.tileSize)

    if (city.inBounds?.(x, y)) {
      contact.tileX = x
      contact.tileY = y
      contact.tileIndex = city.index(x, y)
      return
    }
  }

  setContactTile(contact, cloneTile(firstTile) || cloneTile(secondTile))
}

function isSameUnchangedTile(contact, firstNpc, secondNpc) {
  const firstTile = firstNpc?.tile

  return Boolean(
    firstTile &&
    firstTile.index === secondNpc?.tile?.index &&
    contact.tileIndex === firstTile.index
  )
}

function setContactTile(contact, tile) {
  if (!tile) {
    contact.tileX = null
    contact.tileY = null
    contact.tileIndex = null
    return
  }

  contact.tileX = tile.x
  contact.tileY = tile.y
  contact.tileIndex = tile.index
}

function roundMetric(value) {
  return Math.round(Number(value) * 10000) / 10000
}
