import * as PIXI from 'pixi.js'
import { fillRect } from './pixi-rendering.js'

const DAY_NIGHT_OVERLAY_COLOR = 0x07111f
const DAY_NIGHT_OVERLAY_ZORDER = 3
const MAX_NIGHT_ALPHA = 0.48
const DAYLIGHT_CUTOFF = 0.16

export function createDayNightOverlay(city, entityLayer, clock, options = {}) {
  const graphics = new PIXI.Graphics()
  const maxAlpha = positiveNumberOrDefault(options.maxAlpha, MAX_NIGHT_ALPHA)
  let enabled = options.enabled !== false

  graphics.eventMode = 'none'
  graphics.zIndex = Number.isFinite(options.zorder) ? options.zorder : DAY_NIGHT_OVERLAY_ZORDER
  graphics.zorder = graphics.zIndex
  graphics.visible = false
  entityLayer.sortableChildren = true
  fillRect(
    graphics,
    0,
    0,
    city.width * city.tileSize,
    city.height * city.tileSize,
    DAY_NIGHT_OVERLAY_COLOR,
    1
  )
  entityLayer.addChild(graphics)

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled)
    render()
  }

  function render() {
    const alpha = enabled ? dayNightOverlayAlpha(clock.getTimeOfDayHours(), maxAlpha) : 0

    graphics.alpha = alpha
    graphics.visible = alpha > 0
  }

  function destroy() {
    if (graphics.parent && typeof graphics.parent.removeChild === 'function') {
      graphics.parent.removeChild(graphics)
    }

    graphics.destroy()
  }

  render()

  return {
    graphics,
    render,
    setEnabled,
    get enabled() {
      return enabled
    },
    destroy
  }
}

export function dayNightOverlayAlpha(hour, maxAlpha = MAX_NIGHT_ALPHA) {
  const normalizedHour = normalizeHour(hour)
  const nightFactor = (1 - Math.cos(((normalizedHour - 12) / 24) * Math.PI * 2)) / 2
  const visibleNightFactor = Math.max(0, (nightFactor - DAYLIGHT_CUTOFF) / (1 - DAYLIGHT_CUTOFF))

  return visibleNightFactor * maxAlpha
}

function normalizeHour(hour) {
  const value = Number(hour)

  if (!Number.isFinite(value)) {
    return 12
  }

  return ((value % 24) + 24) % 24
}

function positiveNumberOrDefault(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : fallback
}
