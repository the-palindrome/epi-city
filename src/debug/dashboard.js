import * as PIXI from 'pixi.js'
import {
  DASHBOARD_OVERLAYS,
  DEBUG_OVERLAY_COLORS,
  TILE_TYPE_OVERLAY_COLORS
} from '../core/constants.js'
import { clearPixiContainer, fillRect } from '../render/pixi-rendering.js'

export function installDebugDashboard(city, overlayLayer) {
  const dashboard = document.getElementById('debug-dashboard')
  const overlayState = Object.fromEntries(DASHBOARD_OVERLAYS.map((overlay) => [overlay.id, false]))
  const controls = new Map()
  const layers = new Map()

  dashboard.innerHTML = ''
  dashboard.appendChild(createDashboardTitle())

  for (const overlay of DASHBOARD_OVERLAYS) {
    const control = createOverlayToggle(overlay)

    controls.set(overlay.id, control.input)
    dashboard.appendChild(control.label)

    control.input.addEventListener('change', () => {
      setOverlay(overlay.id, control.input.checked)
    })
  }

  function render() {
    for (const overlay of DASHBOARD_OVERLAYS) {
      const enabled = overlayState[overlay.id]
      const layer = enabled ? ensureOverlayLayer(overlay) : layers.get(overlay.id)

      if (layer) {
        layer.visible = enabled
      }
    }
  }

  function ensureOverlayLayer(overlay) {
    if (!layers.has(overlay.id)) {
      const layer = new PIXI.Container()

      layer.eventMode = 'none'

      if (overlay.kind === 'tileType') {
        drawTileTypeOverlay(city, layer)
      } else {
        drawBehaviorOverlay(city, layer, city[overlay.layer])
      }

      overlayLayer.addChild(layer)
      layers.set(overlay.id, layer)
    }

    return layers.get(overlay.id)
  }

  function setOverlay(id, enabled) {
    if (!Object.prototype.hasOwnProperty.call(overlayState, id)) {
      throw new Error(`Unknown debug overlay "${id}".`)
    }

    overlayState[id] = Boolean(enabled)
    controls.get(id).checked = overlayState[id]
    render()
  }

  function toggleDashboard(force) {
    const shouldHide = typeof force === 'boolean' ? !force : !dashboard.classList.contains('hidden')
    dashboard.classList.toggle('hidden', shouldHide)
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key.toLowerCase() !== 'd' || isEditableTarget(event.target)) {
      return
    }

    event.preventDefault()
    toggleDashboard()
  }

  document.addEventListener('keydown', onKeyDown)

  return {
    element: dashboard,
    overlays: overlayState,
    setOverlay,
    toggle: toggleDashboard,
    render,
    destroy() {
      document.removeEventListener('keydown', onKeyDown)
      clearPixiContainer(overlayLayer)
      dashboard.innerHTML = ''
      layers.clear()
    }
  }
}

function createDashboardTitle() {
  const title = document.createElement('div')
  const shortcut = document.createElement('span')

  title.className = 'dashboard-title'
  title.textContent = 'Dashboard'
  shortcut.className = 'dashboard-shortcut'
  shortcut.textContent = 'D'
  title.appendChild(shortcut)

  return title
}

function createOverlayToggle(overlay) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  const text = document.createElement('span')

  label.className = 'dashboard-toggle'
  input.type = 'checkbox'
  input.dataset.overlayToggle = overlay.id
  text.textContent = overlay.label

  label.appendChild(input)
  label.appendChild(text)

  return { label, input }
}

function isEditableTarget(target) {
  if (!target || !target.tagName) {
    return false
  }

  if (target.tagName === 'INPUT' && target.type === 'checkbox') {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function drawTileTypeOverlay(city, layer) {
  drawChunkedOverlay(city, layer, (graphics, x, y) => {
    const variant = city.getTileVariant(x, y)

    if (variant.category === 'crosswalk') {
      drawCrosswalkTileTypeOverlay(graphics, city, x, y)
      return
    }

    fillRect(
      graphics,
      x * city.tileSize,
      y * city.tileSize,
      city.tileSize,
      city.tileSize,
      TILE_TYPE_OVERLAY_COLORS[variant.category] || TILE_TYPE_OVERLAY_COLORS.building,
      TILE_TYPE_OVERLAY_COLORS.alpha
    )
  })
}

function drawBehaviorOverlay(city, layer, propertyLayer) {
  drawChunkedOverlay(city, layer, (graphics, x, y) => {
    const enabled = propertyLayer[city.index(x, y)] === 1

    fillRect(
      graphics,
      x * city.tileSize,
      y * city.tileSize,
      city.tileSize,
      city.tileSize,
      enabled ? DEBUG_OVERLAY_COLORS.enabled : DEBUG_OVERLAY_COLORS.disabled,
      enabled ? DEBUG_OVERLAY_COLORS.enabledAlpha : DEBUG_OVERLAY_COLORS.disabledAlpha
    )
  })
}

function drawCrosswalkTileTypeOverlay(graphics, city, x, y) {
  const tileSize = city.tileSize
  const px = x * tileSize
  const py = y * tileSize
  const stripeCount = 4
  const stripeWidth = Math.max(2, Math.round(tileSize * 0.12))
  const stripeGap = Math.max(2, Math.round(tileSize * 0.09))
  const stripeHeight = Math.max(1, tileSize - Math.round(tileSize * 0.22))
  const stripeTop = py + Math.round((tileSize - stripeHeight) / 2)
  const stripeSpan = stripeCount * stripeWidth + (stripeCount - 1) * stripeGap
  const stripeLeft = px + Math.round((tileSize - stripeSpan) / 2)

  fillRect(graphics, px, py, tileSize, tileSize, TILE_TYPE_OVERLAY_COLORS.crosswalk, TILE_TYPE_OVERLAY_COLORS.alpha)

  for (let stripe = 0; stripe < stripeCount; stripe += 1) {
    fillRect(
      graphics,
      stripeLeft + stripe * (stripeWidth + stripeGap),
      stripeTop,
      stripeWidth,
      stripeHeight,
      TILE_TYPE_OVERLAY_COLORS.crosswalkStripe,
      TILE_TYPE_OVERLAY_COLORS.alpha
    )
  }
}

function drawChunkedOverlay(city, layer, drawTile) {
  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const graphics = new PIXI.Graphics()

      graphics.eventMode = 'none'

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          drawTile(graphics, x, y)
        }
      }

      layer.addChild(graphics)
    }
  }
}
