export function drawEntityTrails(graphics, entities, trailHistories, trailLength, colorForEntity, alpha = 0.5) {
  const activeIds = new Set()
  const maxPoints = Math.max(2, trailLength + 1)

  for (const entity of entities) {
    const point = finitePosition(entity?.position)

    if (!point) {
      continue
    }

    activeIds.add(entity.id)

    const history = trailHistories.get(entity.id) || []
    const last = history[history.length - 1]

    if (!last || last.x !== point.x || last.y !== point.y) {
      history.push(point)
    }

    while (history.length > maxPoints) {
      history.shift()
    }

    trailHistories.set(entity.id, history)

    if (history.length > 1) {
      strokePolyline(graphics, history, {
        width: 2,
        color: colorForEntity(entity),
        alpha
      })
    }
  }

  for (const id of trailHistories.keys()) {
    if (!activeIds.has(id)) {
      trailHistories.delete(id)
    }
  }
}

export function strokePolyline(graphics, points, style) {
  if (points.length < 2 || typeof graphics.moveTo !== 'function') {
    return
  }

  graphics.moveTo(points[0].x, points[0].y)

  for (let index = 1; index < points.length; index += 1) {
    graphics.lineTo(points[index].x, points[index].y)
  }

  graphics.stroke(style)
}

export function finitePosition(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null
  }

  return {
    x: Math.round(position.x),
    y: Math.round(position.y)
  }
}
