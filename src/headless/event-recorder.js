import { worldUnitsToMeters } from '../core/scale.js'

export class HeadlessEventRecorder {
  constructor({ city, clock }) {
    this.city = city
    this.clock = clock
    this.events = []
    this.activeContacts = new Map()
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
    const pair = orderedNpcIds(firstNpc, secondNpc)
    const key = pair.join(':')
    const distanceMeters = roundMetric(worldUnitsToMeters(distanceWorldUnits))
    let contact = this.activeContacts.get(key)

    if (!contact) {
      contact = {
        event: 'contact',
        id: this.nextId('contact'),
        npcs: pair.map(formatNpcId),
        at,
        until: at,
        durationSeconds: 0,
        where: this.whereBetween(firstNpc, secondNpc),
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
    contact.where = this.whereBetween(firstNpc, secondNpc)
  }

  closeInactiveContacts(at = this.getAt()) {
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

function orderedNpcIds(firstNpc, secondNpc) {
  const firstId = Number(firstNpc?.id)
  const secondId = Number(secondNpc?.id)

  return firstId <= secondId ? [firstId, secondId] : [secondId, firstId]
}

function cleanContactEvent(contact) {
  const { lastObservedAt, ...event } = contact

  return event
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

function roundMetric(value) {
  return Number(Number(value).toFixed(4))
}
