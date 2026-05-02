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
  drawChunkedOverlay(city, layer, (x, y) => {
    const variant = city.getTileVariant(x, y)
    return {
      color: TILE_TYPE_OVERLAY_COLORS[variant.category] || TILE_TYPE_OVERLAY_COLORS.building,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    }
  })
}

function drawBehaviorOverlay(city, layer, propertyLayer) {
  drawChunkedOverlay(city, layer, (x, y) => {
    const enabled = propertyLayer[city.index(x, y)] === 1

    return {
      color: enabled ? DEBUG_OVERLAY_COLORS.enabled : DEBUG_OVERLAY_COLORS.disabled,
      alpha: enabled ? DEBUG_OVERLAY_COLORS.enabledAlpha : DEBUG_OVERLAY_COLORS.disabledAlpha
    }
  })
}

function drawChunkedOverlay(city, layer, colorAt) {
  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const graphics = new PIXI.Graphics()

      graphics.eventMode = 'none'

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          const { color, alpha } = colorAt(x, y)

          fillRect(graphics, x * city.tileSize, y * city.tileSize, city.tileSize, city.tileSize, color, alpha)
        }
      }

      layer.addChild(graphics)
    }
  }
}
