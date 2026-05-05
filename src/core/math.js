export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function indexOf(x, y, width) {
  return y * width + x
}

export function octileDistance(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  const diagonal = Math.min(dx, dy)
  const straight = Math.max(dx, dy) - diagonal

  return diagonal * 14 + straight * 10
}

export function canvasPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect()

  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  }
}
