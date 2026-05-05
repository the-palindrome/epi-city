import * as PIXI from 'pixi.js'
import { CAR_CONFIG, NPC_CONFIG } from '../core/constants.js'
import { canvasPoint } from '../core/math.js'

const PATH_OVERLAY_ZORDER = 6
const CLICK_DRAG_TOLERANCE_PX = 5
const PATH_COLORS = Object.freeze({
  car: 0xffe66d,
  npc: 0x38d8ff,
  outline: 0x10151f
})

export function createEntityPathSelection({
  app,
  camera,
  city,
  entityLayer,
  getCarSimulation,
  getNpcSimulation,
  requestRender
}) {
  const graphics = new PIXI.Graphics()
  let selected = null
  let pointerDown = null
  let destroyed = false

  graphics.eventMode = 'none'
  graphics.zIndex = PATH_OVERLAY_ZORDER
  graphics.zorder = PATH_OVERLAY_ZORDER
  entityLayer.sortableChildren = true
  entityLayer.addChild(graphics)

  function onMouseDown(event) {
    if (event.button !== 0) {
      return
    }

    pointerDown = { x: event.clientX, y: event.clientY }
  }

  function onMouseUp(event) {
    if (event.button !== 0 || !pointerDown) {
      pointerDown = null
      return
    }

    const dx = event.clientX - pointerDown.x
    const dy = event.clientY - pointerDown.y
    pointerDown = null

    if (Math.hypot(dx, dy) > CLICK_DRAG_TOLERANCE_PX) {
      return
    }

    const point = canvasPoint(app.canvas, event)
    const worldPoint = {
      x: (point.x - camera.x) / camera.zoom,
      y: (point.y - camera.y) / camera.zoom
    }
    const hit = findSelectableEntityAt(worldPoint, city, getNpcSimulation()?.npcs || [], getCarSimulation()?.cars || [])

    selected = hit ? { kind: hit.kind, id: hit.entity.id } : null
    render()

    if (typeof requestRender === 'function') {
      requestRender()
    }
  }

  app.canvas.addEventListener('mousedown', onMouseDown)
  app.canvas.addEventListener('mouseup', onMouseUp)

  function selectedEntity() {
    if (!selected) {
      return null
    }

    const entities = selected.kind === 'car'
      ? getCarSimulation()?.cars || []
      : getNpcSimulation()?.npcs || []
    const entity = entities.find((candidate) => candidate.id === selected.id)

    return entity ? { kind: selected.kind, entity } : null
  }

  function render() {
    if (destroyed) {
      return
    }

    graphics.clear()

    const selection = selectedEntity()

    if (!selection) {
      selected = null
      return
    }

    const points = selection.kind === 'car'
      ? carPathPoints(selection.entity, getCarSimulation()?.router?.network)
      : npcPathPoints(city, selection.entity)

    drawSelectionMarker(graphics, selection.kind, selection.entity, city)
    drawDirectedPath(graphics, points, PATH_COLORS[selection.kind], city.tileSize)
  }

  function clearSelection() {
    selected = null
    graphics.clear()
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    app.canvas.removeEventListener('mousedown', onMouseDown)
    app.canvas.removeEventListener('mouseup', onMouseUp)

    if (graphics.parent) {
      graphics.parent.removeChild(graphics)
    }

    graphics.destroy()
  }

  return {
    graphics,
    render,
    clearSelection,
    destroy,
    get selected() {
      return selected ? { ...selected } : null
    }
  }
}

export function findSelectableEntityAt(point, city, npcs, cars) {
  let best = null

  for (const car of cars) {
    const score = carHitScore(point, car, city)

    if (score !== null && (!best || score < best.score)) {
      best = { kind: 'car', entity: car, score }
    }
  }

  for (const npc of npcs) {
    const score = npcHitScore(point, npc, city)

    if (score !== null && (!best || score < best.score)) {
      best = { kind: 'npc', entity: npc, score }
    }
  }

  return best
}

export function npcPathPoints(city, npc) {
  if (!npc || !npc.present) {
    return []
  }

  const points = [{ x: npc.position.x, y: npc.position.y }]
  const route = npc.routing?.path
  let cursor = npc.routing?.cursor || 0

  if (npc.movement?.target) {
    pushUniquePoint(points, npc.movement.target.position)
    cursor = Number.isInteger(npc.movement.target.routeCursor)
      ? npc.movement.target.routeCursor + 1
      : cursor
  }

  if (route) {
    for (let index = cursor; index < route.length; index += 1) {
      pushUniquePoint(points, routePoint(city, route[index]))
    }
  }

  return points
}

export function carPathPoints(car, network) {
  if (!car || !car.position || !car.route) {
    return []
  }

  const points = [{ x: car.position.x, y: car.position.y }]

  if (car.movement?.edge) {
    appendWorldPath(points, car.movement.edge.worldPath, true)
  }

  for (let cursor = car.route.cursor; cursor < car.route.edges.length; cursor += 1) {
    const edge = network?.edges?.[car.route.edges[cursor]]

    if (edge) {
      appendWorldPath(points, edge.worldPath, true)
    }
  }

  return points
}

function carHitScore(point, car, city) {
  if (!car?.position) {
    return null
  }

  const direction = car.direction || { dx: 1, dy: 0 }
  const horizontal = Math.abs(direction.dx) >= Math.abs(direction.dy)
  const length = car.state === 'parked'
    ? car.lengthTiles * city.tileSize * 0.82
    : CAR_CONFIG.roadBodyLength
  const width = CAR_CONFIG.bodyWidth
  const halfWidth = (horizontal ? length : width) / 2 + 5
  const halfHeight = (horizontal ? width : length) / 2 + 5
  const dx = Math.abs(point.x - car.position.x)
  const dy = Math.abs(point.y - car.position.y)

  if (dx > halfWidth || dy > halfHeight) {
    return null
  }

  return Math.max(dx / halfWidth, dy / halfHeight)
}

function npcHitScore(point, npc) {
  if (!npc?.present || !npc.position) {
    return null
  }

  const radius = Math.max(NPC_CONFIG.size, 12)
  const distance = Math.hypot(point.x - npc.position.x, point.y - npc.position.y)

  return distance <= radius ? distance / radius : null
}

function routePoint(city, value) {
  const index = typeof value === 'number' ? value : city.index(value.x, value.y)
  const x = index % city.width
  const y = Math.floor(index / city.width)

  return {
    x: (x + 0.5) * city.tileSize,
    y: (y + 0.5) * city.tileSize
  }
}

function appendWorldPath(points, worldPath, skipFirst) {
  if (!worldPath) {
    return
  }

  for (let index = skipFirst ? 1 : 0; index < worldPath.length; index += 1) {
    pushUniquePoint(points, { x: worldPath[index][0], y: worldPath[index][1] })
  }
}

function pushUniquePoint(points, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return
  }

  const previous = points[points.length - 1]

  if (previous && previous.x === point.x && previous.y === point.y) {
    return
  }

  points.push({ x: point.x, y: point.y })
}

function drawSelectionMarker(graphics, kind, entity, city) {
  if (!entity.position || typeof graphics.circle !== 'function') {
    return
  }

  const radius = kind === 'car'
    ? Math.max(CAR_CONFIG.bodyWidth, city.tileSize * 0.35)
    : Math.max(NPC_CONFIG.size, city.tileSize * 0.22)

  graphics
    .circle(entity.position.x, entity.position.y, radius)
    .stroke({ width: Math.max(2, city.tileSize * 0.05), color: PATH_COLORS[kind], alpha: 0.9 })
}

function drawDirectedPath(graphics, points, color, tileSize) {
  if (points.length < 2 || typeof graphics.moveTo !== 'function') {
    return
  }

  const lineWidth = Math.max(2, tileSize * 0.08)

  strokePath(graphics, points, lineWidth + 3, PATH_COLORS.outline, 0.55)
  strokePath(graphics, points, lineWidth, color, 0.95)
  drawArrowheads(graphics, points, color, tileSize)
}

function strokePath(graphics, points, width, color, alpha) {
  graphics.moveTo(points[0].x, points[0].y)

  for (let index = 1; index < points.length; index += 1) {
    graphics.lineTo(points[index].x, points[index].y)
  }

  graphics.stroke({ width, color, alpha })
}

function drawArrowheads(graphics, points, color, tileSize) {
  const step = Math.max(4, Math.floor(points.length / 6))
  let lastArrowIndex = -1

  for (let index = step; index < points.length; index += step) {
    drawArrowhead(graphics, points[index - 1], points[index], color, tileSize)
    lastArrowIndex = index
  }

  if (lastArrowIndex !== points.length - 1) {
    drawArrowhead(graphics, points[points.length - 2], points[points.length - 1], color, tileSize)
  }
}

function drawArrowhead(graphics, from, to, color, tileSize) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)

  if (!Number.isFinite(angle)) {
    return
  }

  const size = Math.max(5, tileSize * 0.16)
  const left = {
    x: to.x - Math.cos(angle - Math.PI / 6) * size,
    y: to.y - Math.sin(angle - Math.PI / 6) * size
  }
  const right = {
    x: to.x - Math.cos(angle + Math.PI / 6) * size,
    y: to.y - Math.sin(angle + Math.PI / 6) * size
  }

  graphics
    .moveTo(to.x, to.y)
    .lineTo(left.x, left.y)
    .moveTo(to.x, to.y)
    .lineTo(right.x, right.y)
    .stroke({ width: Math.max(2, tileSize * 0.06), color, alpha: 0.95 })
}
