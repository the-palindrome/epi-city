export function createCanvas(width, height) {
  if (globalThis.OffscreenCanvas) {
    return new OffscreenCanvas(width, height)
  }

  if (globalThis.document && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')

    canvas.width = width
    canvas.height = height
    return canvas
  }

  return null
}

export function createCanvasGraphics(context) {
  return {
    rect(x, y, width, height) {
      return {
        fill: (fillStyle) => {
          context.fillStyle = canvasFillStyle(fillStyle)
          context.fillRect(x, y, width, height)
        }
      }
    }
  }
}

function canvasFillStyle(fillStyle) {
  const color = Number.isInteger(fillStyle?.color) ? fillStyle.color & 0xffffff : 0xffffff
  const alpha = Number.isFinite(fillStyle?.alpha) ? Math.min(Math.max(fillStyle.alpha, 0), 1) : 1
  const red = (color >> 16) & 0xff
  const green = (color >> 8) & 0xff
  const blue = color & 0xff

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
