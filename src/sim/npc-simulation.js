import * as PIXI from 'pixi.js'
import { DIRECTIONS, NPC_CONFIG } from '../core/constants.js'
import { createSystemRandom } from '../core/random.js'
import { fillRect } from '../render/pixi-rendering.js'

export function createNpcSimulation(city, entityLayer, config) {
  const graphics = new PIXI.Graphics()
  const random = config.random || createSystemRandom()
  const zorder = Number.isFinite(config.zorder) ? config.zorder : NPC_CONFIG.zorder
  const occupiedSlots = new Int32Array(city.tiles.length * config.tileCapacity)
  const reservedSlots = new Int32Array(city.tiles.length * config.tileCapacity)
  const spawnSlots = collectNpcSpawnSlots(city, config.tileCapacity)
  const npcs = []
  const context = {
    city,
    occupiedSlots,
    reservedSlots,
    random,
    zorder,
    config
  }
  let destroyed = false

  occupiedSlots.fill(-1)
  reservedSlots.fill(-1)
  graphics.eventMode = 'none'
  graphics.zIndex = zorder
  graphics.zorder = zorder
  entityLayer.eventMode = 'none'
  entityLayer.sortableChildren = true
  entityLayer.addChild(graphics)

  for (let id = 0; id < config.count && spawnSlots.length > 0; id += 1) {
    const spawnSlotIndex = takeRandomArrayItem(spawnSlots, random)
    const spawnSlot = npcSlotFromIndex(spawnSlotIndex, config.tileCapacity)
    const tileIndex = spawnSlot.tileIndex
    const tileX = tileIndex % city.width
    const tileY = Math.floor(tileIndex / city.width)
    const position = tileSlotPosition(city, tileX, tileY, spawnSlot.slot, config)

    occupiedSlots[spawnSlotIndex] = id
    npcs.push(createNpcEntity({
      id,
      position,
      tile: { x: tileX, y: tileY, index: tileIndex },
      slot: { id: spawnSlot.slot, index: spawnSlotIndex },
      random,
      zorder,
      config
    }))
  }

  function update(deltaSeconds) {
    if (destroyed) {
      return
    }

    const safeDelta = Math.min(Math.max(deltaSeconds, 0), 0.1)

    for (const npc of npcs) {
      updateNpc(npc, safeDelta, context)
    }
  }

  function render() {
    if (destroyed) {
      return
    }

    drawNpcs(graphics, npcs, config)
  }

  render()

  return {
    npcs,
    occupiedSlots,
    reservedSlots,
    tileCapacity: config.tileCapacity,
    graphics,
    update,
    render,
    destroy() {
      destroyed = true

      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }

      graphics.destroy()
    }
  }
}

function createNpcEntity({ id, position, tile, slot, random, zorder, config }) {
  return {
    id,
    zorder,
    position: { x: position.x, y: position.y },
    tile: { x: tile.x, y: tile.y, index: tile.index },
    slot: { id: slot.id, index: slot.index },
    movement: {
      speed: random.between(config.minSpeed, config.maxSpeed),
      target: null
    }
  }
}

function collectNpcSpawnSlots(city, tileCapacity) {
  const slots = []

  for (let index = 0; index < city.tileWalkable.length; index += 1) {
    if (city.tileWalkable[index] && !city.tileCrosswalk[index]) {
      for (let slot = 0; slot < tileCapacity; slot += 1) {
        slots.push(npcSlotIndex(index, slot, tileCapacity))
      }
    }
  }

  return slots
}

function updateNpc(npc, deltaSeconds, context) {
  if (npc.movement.target) {
    moveNpcTowardTarget(npc, deltaSeconds, context)
    return
  }

  chooseNpcNextTile(npc, context)
}

function moveNpcTowardTarget(npc, deltaSeconds, context) {
  const { occupiedSlots, reservedSlots } = context
  const target = npc.movement.target
  const dx = target.position.x - npc.position.x
  const dy = target.position.y - npc.position.y
  const distance = Math.hypot(dx, dy)
  const maxStep = npc.movement.speed * deltaSeconds

  if (distance <= maxStep || distance === 0) {
    occupiedSlots[npc.slot.index] = -1
    reservedSlots[target.slot.index] = -1
    occupiedSlots[target.slot.index] = npc.id
    npc.position.x = target.position.x
    npc.position.y = target.position.y
    npc.tile.x = target.tile.x
    npc.tile.y = target.tile.y
    npc.tile.index = target.tile.index
    npc.slot.id = target.slot.id
    npc.slot.index = target.slot.index
    npc.movement.target = null
    chooseNpcNextTile(npc, context)
    return
  }

  const ratio = maxStep / distance
  npc.position.x += dx * ratio
  npc.position.y += dy * ratio
}

function chooseNpcNextTile(npc, context) {
  const { city, occupiedSlots, reservedSlots, random, config } = context
  const start = random.int(DIRECTIONS.length)

  for (let offset = 0; offset < DIRECTIONS.length; offset += 1) {
    const direction = DIRECTIONS[(start + offset) % DIRECTIONS.length]
    const candidateX = npc.tile.x + direction.dx
    const candidateY = npc.tile.y + direction.dy

    if (!city.canStep(npc.tile.x, npc.tile.y, candidateX, candidateY, 'pedestrian')) {
      continue
    }

    const targetIndex = city.index(candidateX, candidateY)
    const targetSlot = findAvailableNpcSlot(targetIndex, occupiedSlots, reservedSlots, random, config.tileCapacity)

    if (!targetSlot) {
      continue
    }

    const target = tileSlotPosition(city, candidateX, candidateY, targetSlot.slot, config)

    reservedSlots[targetSlot.slotIndex] = npc.id
    npc.movement.target = {
      position: target,
      tile: {
        x: candidateX,
        y: candidateY,
        index: targetIndex
      },
      slot: {
        id: targetSlot.slot,
        index: targetSlot.slotIndex
      }
    }
    return
  }
}

function findAvailableNpcSlot(tileIndex, occupiedSlots, reservedSlots, random, tileCapacity) {
  const startSlot = random.int(tileCapacity)

  for (let offset = 0; offset < tileCapacity; offset += 1) {
    const slot = (startSlot + offset) % tileCapacity
    const slotIndex = npcSlotIndex(tileIndex, slot, tileCapacity)

    if (occupiedSlots[slotIndex] === -1 && reservedSlots[slotIndex] === -1) {
      return { slot, slotIndex }
    }
  }

  return null
}

function npcSlotIndex(tileIndex, slot, tileCapacity) {
  return tileIndex * tileCapacity + slot
}

function npcSlotFromIndex(slotIndex, tileCapacity) {
  return {
    tileIndex: Math.floor(slotIndex / tileCapacity),
    slot: slotIndex % tileCapacity
  }
}

function tileSlotPosition(city, tileX, tileY, slot, config) {
  const centerX = (tileX + 0.5) * city.tileSize
  const centerY = (tileY + 0.5) * city.tileSize
  const offsetIndex = slot - (config.tileCapacity - 1) / 2

  return {
    x: centerX + offsetIndex * config.slotSpacing,
    y: centerY
  }
}

function drawNpcs(graphics, npcs, config) {
  graphics.clear()

  for (const npc of npcs) {
    drawNpcBlob(graphics, npc.position.x, npc.position.y, config.size, config.color)
  }
}

function drawNpcBlob(graphics, x, y, size, color) {
  const px = Math.round(x - size / 2)
  const py = Math.round(y - size / 2)

  fillRect(graphics, px + 1, py, size - 2, size, color)
  fillRect(graphics, px, py + 2, size, size - 4, color)
}

function takeRandomArrayItem(items, random) {
  const index = random.int(items.length)
  const item = items[index]

  items[index] = items[items.length - 1]
  items.pop()

  return item
}
