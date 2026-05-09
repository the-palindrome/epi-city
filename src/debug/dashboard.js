import * as PIXI from 'pixi.js'
import {
  DASHBOARD_OVERLAYS,
  ENTITY_RENDER_DEBUG_CONFIG,
  ENTITY_RENDER_MODE_ID,
  ENTITY_RENDER_MODE_OPTIONS,
  ENTITY_RENDER_MODES,
  INFECTION_CONFIG,
  SEIR_HEATMAP_CONFIG,
  TILE_TYPE_OVERLAY_COLOR_SCHEMES,
  TILE_TYPE_OVERLAY_COLORS,
  TILE_TYPE_OVERLAY_SCHEME_ID,
  TILE_TYPE_OVERLAY_SCHEME_OPTIONS
} from '../core/constants.js'
import { fillRect } from '../render/pixi-rendering.js'

const RENDERING_OPACITY_RANGE = Object.freeze({ min: 0, max: 1, step: 0.05 })
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const EPIDEMIC_GRAPH_CONFIG = Object.freeze({
  width: 336,
  height: 176,
  padding: Object.freeze({ top: 12, right: 14, bottom: 36, left: 46 }),
  sampleIntervalSeconds: 5 * 60,
  minTimeSpanSeconds: 60,
  minValueSpan: 1
})
const EPIDEMIC_GRAPH_STATES = Object.freeze([
  Object.freeze({ id: 'susceptible', label: 'S', color: INFECTION_CONFIG.colors.susceptible }),
  Object.freeze({ id: 'exposed', label: 'E', color: INFECTION_CONFIG.colors.exposed }),
  Object.freeze({ id: 'infectious', label: 'I', color: INFECTION_CONFIG.colors.infectious }),
  Object.freeze({ id: 'recovered', label: 'R', color: INFECTION_CONFIG.colors.recovered })
])
let epidemicGraphSequence = 0

export function installDebugDashboard(city, entityLayer, simulationControls = {}) {
  const dashboard = document.getElementById('debug-dashboard')
  const overlayDashboard = document.getElementById('overlay-dashboard')
  const graphDashboard = document.getElementById('graph-dashboard')
  const overlayState = Object.fromEntries(DASHBOARD_OVERLAYS.map((overlay) => [overlay.id, false]))
  const mapOverlays = DASHBOARD_OVERLAYS.filter((overlay) => overlay.kind !== 'heatmap')
  const heatmapOverlays = DASHBOARD_OVERLAYS.filter((overlay) => overlay.kind === 'heatmap')
  const controls = new Map()
  const layers = new Map()
  const simulation = createSimulationControls(simulationControls)
  const epidemicGraph = createEpidemicGraph(simulationControls)
  const graphResizeHandle = createGraphResizeHandle()
  const graphResizer = createGraphDashboardResizer(graphDashboard, graphResizeHandle, () => epidemicGraph.render())
  const heatmapRadiusRange = normalizeHeatmapRadiusRange(simulationControls.heatmapRadiusRange)
  const infectionEdgeDurationRange = normalizeInfectionEdgeDurationRange(simulationControls.infectionEdgeDurationRange)
  const contactEdgeDurationRange = normalizeContactEdgeDurationRange(simulationControls.contactEdgeDurationRange)
  const pathTrailLengthRange = normalizePathTrailLengthRange(simulationControls.pathTrailLengthRange)
  const getNpcs = typeof simulationControls.getNpcs === 'function' ? simulationControls.getNpcs : () => []
  const renderingSettings = {
    mapTextureEnabled: simulationControls.mapTextureEnabled !== false,
    mapTextureOpacity: normalizeRenderingOpacity(simulationControls.mapTextureOpacity ?? 1),
    entityRenderMode: normalizeEntityRenderMode(simulationControls.entityRenderMode),
    infectionRadiusVisible: Boolean(simulationControls.infectionRadiusVisible),
    infectionEdgesVisible: Boolean(simulationControls.infectionEdgesVisible),
    contactEdgesVisible: Boolean(simulationControls.contactEdgesVisible),
    infectionEdgeDurationMinutes: normalizeInfectionEdgeDuration(
      simulationControls.infectionEdgeDurationMinutes ?? ENTITY_RENDER_DEBUG_CONFIG.infectionEdgeDurationMinutes,
      infectionEdgeDurationRange
    ),
    contactEdgeDurationMinutes: normalizeContactEdgeDuration(
      simulationControls.contactEdgeDurationMinutes ?? ENTITY_RENDER_DEBUG_CONFIG.contactEdgeDurationMinutes,
      contactEdgeDurationRange
    ),
    pathTrailsVisible: Boolean(simulationControls.pathTrailsVisible),
    pathTrailLength: normalizePathTrailLength(
      simulationControls.pathTrailLength ?? ENTITY_RENDER_DEBUG_CONFIG.pathTrailLength,
      pathTrailLengthRange
    ),
    tileOverlayScheme: normalizeTileOverlayScheme(simulationControls.tileOverlayScheme),
    tileTypeOpacity: normalizeTileTypeOverlayOpacity(TILE_TYPE_OVERLAY_COLORS.alpha),
    heatmapRadius: normalizeHeatmapRadius(
      simulationControls.heatmapRadius ?? SEIR_HEATMAP_CONFIG.radius,
      heatmapRadiusRange
    )
  }
  const renderingCallbacks = {
    onMapTextureEnabledChange: simulationControls.onMapTextureEnabledChange || noop,
    onMapTextureOpacityChange: simulationControls.onMapTextureOpacityChange || noop,
    onEntityRenderModeChange: simulationControls.onEntityRenderModeChange || noop,
    onInfectionRadiusVisibleChange: simulationControls.onInfectionRadiusVisibleChange || noop,
    onInfectionEdgesVisibleChange: simulationControls.onInfectionEdgesVisibleChange || noop,
    onContactEdgesVisibleChange: simulationControls.onContactEdgesVisibleChange || noop,
    onInfectionEdgeDurationChange: simulationControls.onInfectionEdgeDurationChange || noop,
    onContactEdgeDurationChange: simulationControls.onContactEdgeDurationChange || noop,
    onPathTrailsVisibleChange: simulationControls.onPathTrailsVisibleChange || noop,
    onPathTrailLengthChange: simulationControls.onPathTrailLengthChange || noop,
    onHeatmapRadiusChange: simulationControls.onHeatmapRadiusChange || noop
  }
  const overlaySection = createDashboardSection('Map')
  const entitySection = createDashboardSection('Entities')
  const heatmapSection = createDashboardSection('Heatmap')
  const mapTextureToggle = createMapTextureToggle(renderingSettings.mapTextureEnabled)
  const mapTextureOpacityField = createMapTextureOpacityField(renderingSettings.mapTextureOpacity)
  const entityRenderModeField = createEntityRenderModeField(renderingSettings.entityRenderMode)
  const infectionRadiusToggle = createDashboardToggle({
    labelText: 'infection radius',
    dataset: 'infectionRadiusToggle',
    checked: renderingSettings.infectionRadiusVisible
  })
  const infectionEdgesToggle = createDashboardToggle({
    labelText: 'display infections',
    dataset: 'infectionEdgesToggle',
    checked: renderingSettings.infectionEdgesVisible
  })
  const contactEdgesToggle = createDashboardToggle({
    labelText: 'display contacts',
    dataset: 'contactEdgesToggle',
    checked: renderingSettings.contactEdgesVisible
  })
  const infectionEdgeDurationField = createInfectionEdgeDurationField(
    renderingSettings.infectionEdgeDurationMinutes,
    infectionEdgeDurationRange
  )
  const contactEdgeDurationField = createContactEdgeDurationField(
    renderingSettings.contactEdgeDurationMinutes,
    contactEdgeDurationRange
  )
  const pathTrailsToggle = createDashboardToggle({
    labelText: 'display path trails',
    dataset: 'pathTrailsToggle',
    checked: renderingSettings.pathTrailsVisible
  })
  const pathTrailLengthField = createPathTrailLengthField(
    renderingSettings.pathTrailLength,
    pathTrailLengthRange
  )
  const tileOverlaySchemeField = createTileOverlaySchemeField(renderingSettings.tileOverlayScheme)
  const tileTypeOpacityField = createTileTypeOverlayOpacityField(
    renderingSettings.tileTypeOpacity,
    TILE_TYPE_OVERLAY_COLORS.opacityRange
  )
  const heatmapRadiusField = createHeatmapRadiusField(renderingSettings.heatmapRadius, heatmapRadiusRange)

  dashboard.innerHTML = ''
  overlayDashboard.innerHTML = ''
  graphDashboard.innerHTML = ''
  dashboard.appendChild(createDashboardTitle('simulation', 's'))
  dashboard.appendChild(simulation.element)
  overlayDashboard.appendChild(createDashboardTitle('rendering options', 'r'))
  graphDashboard.appendChild(createDashboardTitle('epidemic', 'g'))
  graphDashboard.appendChild(epidemicGraph.element)
  graphDashboard.appendChild(graphResizeHandle)
  overlaySection.appendChild(mapTextureToggle.label)
  overlaySection.appendChild(mapTextureOpacityField.label)

  for (const overlay of mapOverlays) {
    const control = createOverlayToggle(overlay)

    controls.set(overlay.id, control.input)
    overlaySection.appendChild(control.label)

    control.input.addEventListener('change', () => {
      setOverlay(overlay.id, control.input.checked)
    })
  }

  overlaySection.appendChild(tileOverlaySchemeField.label)
  overlaySection.appendChild(tileTypeOpacityField.label)
  overlayDashboard.appendChild(overlaySection)
  entitySection.appendChild(entityRenderModeField.label)
  entitySection.appendChild(infectionRadiusToggle.label)
  entitySection.appendChild(infectionEdgesToggle.label)
  entitySection.appendChild(infectionEdgeDurationField.label)
  entitySection.appendChild(contactEdgesToggle.label)
  entitySection.appendChild(contactEdgeDurationField.label)
  entitySection.appendChild(pathTrailsToggle.label)
  entitySection.appendChild(pathTrailLengthField.label)
  overlayDashboard.appendChild(entitySection)

  for (const overlay of heatmapOverlays) {
    const control = createOverlayToggle(overlay)

    controls.set(overlay.id, control.input)
    heatmapSection.appendChild(control.label)

    control.input.addEventListener('change', () => {
      setOverlay(overlay.id, control.input.checked)
    })
  }

  heatmapSection.appendChild(heatmapRadiusField.label)
  overlayDashboard.appendChild(heatmapSection)

  mapTextureToggle.input.addEventListener('change', () => {
    setMapTextureEnabled(mapTextureToggle.input.checked)
  })

  mapTextureOpacityField.input.addEventListener('input', () => {
    setMapTextureOpacity(mapTextureOpacityField.input.value)
  })

  tileOverlaySchemeField.select.addEventListener('change', () => {
    setTileOverlayScheme(tileOverlaySchemeField.select.value)
  })

  tileTypeOpacityField.input.addEventListener('input', () => {
    setTileTypeOverlayOpacity(tileTypeOpacityField.input.value)
  })

  entityRenderModeField.select.addEventListener('change', () => {
    setEntityRenderMode(entityRenderModeField.select.value)
  })

  infectionRadiusToggle.input.addEventListener('change', () => {
    setInfectionRadiusVisible(infectionRadiusToggle.input.checked)
  })

  infectionEdgesToggle.input.addEventListener('change', () => {
    setInfectionEdgesVisible(infectionEdgesToggle.input.checked)
  })

  contactEdgesToggle.input.addEventListener('change', () => {
    setContactEdgesVisible(contactEdgesToggle.input.checked)
  })

  infectionEdgeDurationField.slider.addEventListener('input', () => {
    setInfectionEdgeDuration(infectionEdgeDurationField.slider.value)
  })

  infectionEdgeDurationField.input.addEventListener('change', () => {
    setInfectionEdgeDuration(infectionEdgeDurationField.input.value)
  })

  contactEdgeDurationField.slider.addEventListener('input', () => {
    setContactEdgeDuration(contactEdgeDurationField.slider.value)
  })

  contactEdgeDurationField.input.addEventListener('change', () => {
    setContactEdgeDuration(contactEdgeDurationField.input.value)
  })

  pathTrailsToggle.input.addEventListener('change', () => {
    setPathTrailsVisible(pathTrailsToggle.input.checked)
  })

  pathTrailLengthField.slider.addEventListener('input', () => {
    setPathTrailLength(pathTrailLengthField.slider.value)
  })

  pathTrailLengthField.input.addEventListener('change', () => {
    setPathTrailLength(pathTrailLengthField.input.value)
  })

  heatmapRadiusField.slider.addEventListener('input', () => {
    setHeatmapRadius(heatmapRadiusField.slider.value)
  })

  heatmapRadiusField.input.addEventListener('change', () => {
    setHeatmapRadius(heatmapRadiusField.input.value)
  })

  function render() {
    simulation.render()
    epidemicGraph.render()
    let currentHeatmapNpcsByState

    for (const overlay of DASHBOARD_OVERLAYS) {
      const enabled = overlayState[overlay.id]
      const layer = enabled ? ensureOverlayLayer(overlay) : layers.get(overlay.id)

      if (layer) {
        setOverlayLayerVisible(layer, enabled)
      }

      if (enabled && overlay.kind === 'heatmap') {
        if (currentHeatmapNpcsByState === undefined) {
          currentHeatmapNpcsByState = groupHeatmapNpcsByInfection(getNpcs())
        }

        drawHeatmapOverlay(
          city,
          layer,
          currentHeatmapNpcsByState.get(overlay.infection) || [],
          overlay,
          renderingSettings.heatmapRadius
        )
      }
    }
  }

  function ensureOverlayLayer(overlay) {
    if (!layers.has(overlay.id)) {
      const layer = createOverlayLayer(entityLayer)

      if (overlay.kind === 'tileType') {
        drawTileTypeOverlay(city, layer, {
          opacity: renderingSettings.tileTypeOpacity,
          schemeId: renderingSettings.tileOverlayScheme
        })
      } else if (overlay.kind === 'heatmap') {
        ensureHeatmapGraphics(layer)
      } else {
        throw new Error(`Unknown debug overlay kind "${overlay.kind}".`)
      }

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

  function setMapTextureEnabled(enabled) {
    renderingSettings.mapTextureEnabled = Boolean(enabled)
    mapTextureToggle.input.checked = renderingSettings.mapTextureEnabled
    renderingCallbacks.onMapTextureEnabledChange(renderingSettings.mapTextureEnabled)
  }

  function setMapTextureOpacity(opacity) {
    const nextOpacity = normalizeRenderingOpacity(opacity)

    renderingSettings.mapTextureOpacity = nextOpacity
    mapTextureOpacityField.input.value = String(nextOpacity)
    mapTextureOpacityField.value.textContent = formatOpacity(nextOpacity)
    renderingCallbacks.onMapTextureOpacityChange(nextOpacity)
  }

  function setTileOverlayScheme(schemeId) {
    const nextSchemeId = normalizeTileOverlayScheme(schemeId)

    renderingSettings.tileOverlayScheme = nextSchemeId
    tileOverlaySchemeField.select.value = nextSchemeId
    discardOverlayLayer('tileType')
    render()
  }

  function setTileTypeOverlayOpacity(opacity) {
    const nextOpacity = normalizeTileTypeOverlayOpacity(opacity)

    renderingSettings.tileTypeOpacity = nextOpacity
    tileTypeOpacityField.input.value = String(nextOpacity)
    tileTypeOpacityField.value.textContent = formatOpacity(nextOpacity)
    discardOverlayLayer('tileType')
    render()
  }

  function setEntityRenderMode(mode) {
    const nextMode = normalizeEntityRenderMode(mode)

    renderingSettings.entityRenderMode = nextMode
    entityRenderModeField.select.value = nextMode
    renderingCallbacks.onEntityRenderModeChange(nextMode)
  }

  function setInfectionRadiusVisible(visible) {
    renderingSettings.infectionRadiusVisible = Boolean(visible)
    infectionRadiusToggle.input.checked = renderingSettings.infectionRadiusVisible
    renderingCallbacks.onInfectionRadiusVisibleChange(renderingSettings.infectionRadiusVisible)
  }

  function setInfectionEdgesVisible(visible) {
    renderingSettings.infectionEdgesVisible = Boolean(visible)
    infectionEdgesToggle.input.checked = renderingSettings.infectionEdgesVisible
    renderingCallbacks.onInfectionEdgesVisibleChange(renderingSettings.infectionEdgesVisible)
  }

  function setContactEdgesVisible(visible) {
    renderingSettings.contactEdgesVisible = Boolean(visible)
    contactEdgesToggle.input.checked = renderingSettings.contactEdgesVisible
    renderingCallbacks.onContactEdgesVisibleChange(renderingSettings.contactEdgesVisible)
  }

  function setInfectionEdgeDuration(durationMinutes) {
    const nextDuration = normalizeInfectionEdgeDuration(durationMinutes, infectionEdgeDurationRange)

    renderingSettings.infectionEdgeDurationMinutes = nextDuration
    infectionEdgeDurationField.slider.value = String(nextDuration)
    infectionEdgeDurationField.input.value = formatNumberInput(nextDuration)
    renderingCallbacks.onInfectionEdgeDurationChange(nextDuration)
  }

  function setContactEdgeDuration(durationMinutes) {
    const nextDuration = normalizeContactEdgeDuration(durationMinutes, contactEdgeDurationRange)

    renderingSettings.contactEdgeDurationMinutes = nextDuration
    contactEdgeDurationField.slider.value = String(nextDuration)
    contactEdgeDurationField.input.value = formatNumberInput(nextDuration)
    renderingCallbacks.onContactEdgeDurationChange(nextDuration)
  }

  function setPathTrailsVisible(visible) {
    renderingSettings.pathTrailsVisible = Boolean(visible)
    pathTrailsToggle.input.checked = renderingSettings.pathTrailsVisible
    renderingCallbacks.onPathTrailsVisibleChange(renderingSettings.pathTrailsVisible)
  }

  function setPathTrailLength(length) {
    const nextLength = normalizePathTrailLength(length, pathTrailLengthRange)

    renderingSettings.pathTrailLength = nextLength
    pathTrailLengthField.slider.value = String(nextLength)
    pathTrailLengthField.input.value = String(nextLength)
    renderingCallbacks.onPathTrailLengthChange(nextLength)
  }

  function setHeatmapRadius(radius) {
    const nextRadius = normalizeHeatmapRadius(radius, heatmapRadiusRange)

    renderingSettings.heatmapRadius = nextRadius
    heatmapRadiusField.slider.value = String(nextRadius)
    heatmapRadiusField.input.value = formatNumberInput(nextRadius)
    renderingCallbacks.onHeatmapRadiusChange(nextRadius)
    render()
  }

  function discardOverlayLayer(id) {
    const layer = layers.get(id)

    if (layer) {
      destroyOverlayLayer(layer)
      layers.delete(id)
    }
  }

  function toggleDashboard(force) {
    const shouldHide = typeof force === 'boolean' ? !force : !dashboard.classList.contains('hidden')
    dashboard.classList.toggle('hidden', shouldHide)
  }

  function toggleOverlayDashboard(force) {
    const shouldHide = typeof force === 'boolean' ? !force : !overlayDashboard.classList.contains('hidden')
    overlayDashboard.classList.toggle('hidden', shouldHide)
  }

  function toggleGraphDashboard(force) {
    const shouldHide = typeof force === 'boolean' ? !force : !graphDashboard.classList.contains('hidden')
    graphDashboard.classList.toggle('hidden', shouldHide)
    epidemicGraph.render()
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''

    if (key === 'q' && !isTextEntryTarget(event.target)) {
      event.preventDefault()
      toggleDashboard()
      return
    }

    if (key === 'r' && !isTextEntryTarget(event.target)) {
      event.preventDefault()
      toggleOverlayDashboard()
      return
    }

    if (key === 'g' && !isTextEntryTarget(event.target)) {
      event.preventDefault()
      toggleGraphDashboard()
      return
    }

    if (!isSpaceHotkey(event) || isInteractiveTarget(event.target)) {
      return
    }

    event.preventDefault()
    simulation.togglePlayback()
  }

  document.addEventListener('keydown', onKeyDown)
  dashboard.addEventListener('click', releaseDashboardShortcutFocus)
  dashboard.addEventListener('change', releaseDashboardShortcutFocus)
  overlayDashboard.addEventListener('click', releaseDashboardShortcutFocus)
  overlayDashboard.addEventListener('change', releaseDashboardShortcutFocus)
  graphDashboard.addEventListener('click', releaseDashboardShortcutFocus)
  graphDashboard.addEventListener('change', releaseDashboardShortcutFocus)

  function releaseDashboardShortcutFocus(event) {
    const control = findDashboardShortcutControl(event.currentTarget, event.target)

    if (!control || !shouldReleaseDashboardShortcutFocus(control, event.type)) {
      return
    }

    if (typeof control.blur === 'function') {
      control.blur()
    }
  }

  function removeDashboardShortcutFocusListeners(root) {
    if (root && typeof root.removeEventListener === 'function') {
      root.removeEventListener('click', releaseDashboardShortcutFocus)
      root.removeEventListener('change', releaseDashboardShortcutFocus)
    }
  }

  epidemicGraph.installInteractions()
  graphResizer.install()

  return {
    element: dashboard,
    overlayElement: overlayDashboard,
    graphElement: graphDashboard,
    overlays: overlayState,
    rendering: renderingSettings,
    graph: epidemicGraph,
    simulation,
    setOverlay,
    setMapTextureEnabled,
    setMapTextureOpacity,
    setTileOverlayScheme,
    setTileOverlayOpacity: setTileTypeOverlayOpacity,
    setEntityRenderMode,
    setInfectionRadiusVisible,
    setInfectionEdgesVisible,
    setContactEdgesVisible,
    setInfectionEdgeDuration,
    setContactEdgeDuration,
    setPathTrailsVisible,
    setPathTrailLength,
    setHeatmapRadius,
    toggle: toggleDashboard,
    toggleRenderingOptions: toggleOverlayDashboard,
    toggleGraph: toggleGraphDashboard,
    render,
    destroy() {
      document.removeEventListener('keydown', onKeyDown)
      removeDashboardShortcutFocusListeners(dashboard)
      removeDashboardShortcutFocusListeners(overlayDashboard)
      removeDashboardShortcutFocusListeners(graphDashboard)
      epidemicGraph.destroy()
      graphResizer.destroy()

      for (const layer of layers.values()) {
        destroyOverlayLayer(layer)
      }

      dashboard.innerHTML = ''
      overlayDashboard.innerHTML = ''
      graphDashboard.innerHTML = ''
      layers.clear()
    }
  }
}

function createDashboardTitle(titleText, shortcutText) {
  const title = document.createElement('div')
  const shortcut = document.createElement('span')

  title.className = 'dashboard-title'
  title.textContent = titleText
  shortcut.className = 'dashboard-shortcut'
  shortcut.textContent = shortcutText
  title.appendChild(shortcut)

  return title
}

function createDashboardSection(titleText) {
  const section = document.createElement('div')
  const title = document.createElement('div')

  section.className = 'dashboard-section'
  title.className = 'dashboard-section-title'
  title.textContent = titleText
  section.appendChild(title)

  return section
}

function createGraphResizeHandle() {
  const handle = document.createElement('div')

  handle.className = 'graph-dashboard-resize-handle'
  handle.dataset.graphResizeHandle = 'true'
  handle.setAttribute('aria-hidden', 'true')

  return handle
}

function createGraphDashboardResizer(panel, handle, onResize = noop) {
  let resizeState = null
  let installed = false

  function install() {
    if (installed) {
      return
    }

    installed = true
    handle.addEventListener('pointerdown', onPointerDown)
    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('pointercancel', onPointerUp)
  }

  function onPointerDown(event) {
    if (Number(event.button || 0) !== 0) {
      return
    }

    event.preventDefault()

    const rect = getElementRect(panel)

    resizeState = {
      pointerId: event.pointerId,
      clientX: Number(event.clientX) || 0,
      clientY: Number(event.clientY) || 0,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    }

    setElementPointerCapture(handle, event.pointerId)
  }

  function onPointerMove(event) {
    if (!resizeState || (Number.isFinite(resizeState.pointerId) && event.pointerId !== resizeState.pointerId)) {
      return
    }

    event.preventDefault()

    const bounds = getGraphResizeBounds()
    const dx = (Number(event.clientX) || 0) - resizeState.clientX
    const dy = (Number(event.clientY) || 0) - resizeState.clientY
    const width = Math.min(Math.max(resizeState.width + dx, bounds.minWidth), bounds.maxWidth)
    const height = Math.min(Math.max(resizeState.height - dy, bounds.minHeight), bounds.maxHeight)

    panel.style.width = `${Math.round(width)}px`
    panel.style.height = `${Math.round(height)}px`
    onResize()
  }

  function onPointerUp(event) {
    if (!resizeState || (Number.isFinite(resizeState.pointerId) && event.pointerId !== resizeState.pointerId)) {
      return
    }

    releaseElementPointerCapture(handle, resizeState.pointerId)

    resizeState = null
  }

  function destroy() {
    handle.removeEventListener('pointerdown', onPointerDown)
    handle.removeEventListener('pointermove', onPointerMove)
    handle.removeEventListener('pointerup', onPointerUp)
    handle.removeEventListener('pointercancel', onPointerUp)
    resizeState = null
  }

  return {
    install,
    destroy
  }
}

function createSimulationControls(options) {
  const state = {
    paused: Boolean(options.paused),
    seedEnabled: Boolean(options.seedEnabled),
    seed: options.seed || '',
    speed: options.speed || 1,
    npcCount: normalizeNpcCount(options.npcCount ?? 1000, options.npcCountRange),
    carCount: normalizeCarCount(options.carCount ?? 200, options.carCountRange),
    initialInfectiousCount: normalizeInitialInfectiousCount(options.initialInfectiousCount ?? 4, options.initialInfectiousCountRange),
    infectionDistance: normalizeInfectionDistance(options.infectionDistance ?? INFECTION_CONFIG.infectionDistance, options.infectionDistanceRange),
    infectionProbability: normalizeInfectionProbability(options.infectionProbability ?? 0.03, options.infectionProbabilityRange),
    incubationDays: normalizeIncubationDays(options.incubationDays ?? 1, options.incubationDaysRange),
    infectionDays: normalizeInfectionDays(options.infectionDays ?? 7, options.infectionDaysRange),
    immunityDays: normalizeImmunityDays(options.immunityDays ?? 90, options.immunityDaysRange),
    dayNightOverlayEnabled: options.dayNightOverlayEnabled !== false
  }
  const callbacks = {
    onPlay: options.onPlay || noop,
    onPause: options.onPause || noop,
    onRestart: options.onRestart || noop,
    onSeedEnabledChange: options.onSeedEnabledChange || noop,
    onSeedChange: options.onSeedChange || noop,
    onSpeedChange: options.onSpeedChange || noop,
    onNpcCountChange: options.onNpcCountChange || noop,
    onCarCountChange: options.onCarCountChange || noop,
    onInitialInfectiousCountChange: options.onInitialInfectiousCountChange || noop,
    onInfectionDistanceChange: options.onInfectionDistanceChange || noop,
    onInfectionProbabilityChange: options.onInfectionProbabilityChange || noop,
    onIncubationDaysChange: options.onIncubationDaysChange || noop,
    onInfectionDaysChange: options.onInfectionDaysChange || noop,
    onImmunityDaysChange: options.onImmunityDaysChange || noop,
    onDayNightOverlayChange: options.onDayNightOverlayChange || noop
  }
  const speedRange = normalizeSpeedRange(options.speedRange)
  const npcCountRange = normalizeNpcCountRange(options.npcCountRange)
  const carCountRange = normalizeCarCountRange(options.carCountRange)
  const initialInfectiousCountRange = normalizeInitialInfectiousCountRange(options.initialInfectiousCountRange)
  const infectionDistanceRange = normalizeInfectionDistanceRange(options.infectionDistanceRange)
  const infectionProbabilityRange = normalizeInfectionProbabilityRange(options.infectionProbabilityRange)
  const incubationDaysRange = normalizeIncubationDaysRange(options.incubationDaysRange)
  const infectionDaysRange = normalizeInfectionDaysRange(options.infectionDaysRange)
  const immunityDaysRange = normalizeImmunityDaysRange(options.immunityDaysRange)
  const section = createDashboardSection('Simulation')
  const actions = document.createElement('div')
  const playButton = createDashboardButton('Play', 'play')
  const pauseButton = createDashboardButton('Pause', 'pause')
  const restartButton = createDashboardButton('Restart', 'restart')
  const clockField = createClockField()
  const seedToggle = createSeedToggle(state.seedEnabled)
  const seedField = createSeedField(state.seed)
  const speedField = createSpeedField(state.speed, speedRange)
  const npcCountField = createNpcCountField(state.npcCount, npcCountRange)
  const carCountField = createCarCountField(state.carCount, carCountRange)
  const dayNightToggle = createDayNightToggle(state.dayNightOverlayEnabled)
  const infectionTitle = createDashboardSubsectionTitle('Infection')
  const infectionStatsField = createInfectionStatsField()
  const initialInfectiousCountField = createInitialInfectiousCountField(state.initialInfectiousCount, initialInfectiousCountRange)
  const infectionDistanceField = createInfectionDistanceField(state.infectionDistance, infectionDistanceRange)
  const infectionProbabilityField = createInfectionProbabilityField(state.infectionProbability, infectionProbabilityRange)
  const incubationDaysField = createIncubationDaysField(state.incubationDays, incubationDaysRange)
  const infectionDaysField = createInfectionDaysField(state.infectionDays, infectionDaysRange)
  const immunityDaysField = createImmunityDaysField(state.immunityDays, immunityDaysRange)

  actions.className = 'dashboard-actions'
  actions.appendChild(playButton)
  actions.appendChild(pauseButton)
  actions.appendChild(restartButton)
  section.appendChild(actions)
  section.appendChild(clockField.label)
  section.appendChild(seedToggle.label)
  section.appendChild(seedField.label)
  section.appendChild(speedField.label)
  section.appendChild(npcCountField.label)
  section.appendChild(carCountField.label)
  section.appendChild(dayNightToggle.label)
  section.appendChild(infectionTitle)
  section.appendChild(infectionStatsField.label)
  section.appendChild(initialInfectiousCountField.label)
  section.appendChild(infectionDistanceField.label)
  section.appendChild(infectionProbabilityField.label)
  section.appendChild(incubationDaysField.label)
  section.appendChild(infectionDaysField.label)
  section.appendChild(immunityDaysField.label)

  playButton.addEventListener('click', play)

  pauseButton.addEventListener('click', pause)

  restartButton.addEventListener('click', () => {
    callbacks.onRestart()
  })

  seedToggle.input.addEventListener('change', () => {
    setSeedEnabled(seedToggle.input.checked)
    callbacks.onSeedEnabledChange(state.seedEnabled)
  })

  seedField.input.addEventListener('input', () => {
    state.seed = seedField.input.value
    callbacks.onSeedChange(state.seed)
  })

  speedField.input.addEventListener('input', () => {
    const speed = Number(speedField.input.value)

    setSpeed(speed)
    callbacks.onSpeedChange(state.speed)
  })

  npcCountField.slider.addEventListener('input', () => {
    setNpcCount(npcCountField.slider.value)
  })

  npcCountField.slider.addEventListener('change', () => {
    callbacks.onNpcCountChange(state.npcCount)
  })

  npcCountField.input.addEventListener('change', () => {
    setNpcCount(npcCountField.input.value)
    callbacks.onNpcCountChange(state.npcCount)
  })

  carCountField.slider.addEventListener('input', () => {
    setCarCount(carCountField.slider.value)
  })

  carCountField.slider.addEventListener('change', () => {
    callbacks.onCarCountChange(state.carCount)
  })

  carCountField.input.addEventListener('change', () => {
    setCarCount(carCountField.input.value)
    callbacks.onCarCountChange(state.carCount)
  })

  dayNightToggle.input.addEventListener('change', () => {
    setDayNightOverlayEnabled(dayNightToggle.input.checked)
    callbacks.onDayNightOverlayChange(state.dayNightOverlayEnabled)
  })

  initialInfectiousCountField.input.addEventListener('change', () => {
    setInitialInfectiousCount(initialInfectiousCountField.input.value)
    callbacks.onInitialInfectiousCountChange(state.initialInfectiousCount)
  })

  infectionDistanceField.input.addEventListener('change', () => {
    setInfectionDistance(infectionDistanceField.input.value)
    callbacks.onInfectionDistanceChange(state.infectionDistance)
  })

  infectionProbabilityField.input.addEventListener('change', () => {
    setInfectionProbability(infectionProbabilityField.input.value)
    callbacks.onInfectionProbabilityChange(state.infectionProbability)
  })

  incubationDaysField.input.addEventListener('change', () => {
    setIncubationDays(incubationDaysField.input.value)
    callbacks.onIncubationDaysChange(state.incubationDays)
  })

  infectionDaysField.input.addEventListener('change', () => {
    setInfectionDays(infectionDaysField.input.value)
    callbacks.onInfectionDaysChange(state.infectionDays)
  })

  immunityDaysField.input.addEventListener('change', () => {
    setImmunityDays(immunityDaysField.input.value)
    callbacks.onImmunityDaysChange(state.immunityDays)
  })

  function play() {
    callbacks.onPlay()
    setPaused(false)
  }

  function pause() {
    callbacks.onPause()
    setPaused(true)
  }

  function togglePlayback() {
    if (state.paused) {
      play()
    } else {
      pause()
    }
  }

  function setPaused(paused) {
    state.paused = Boolean(paused)
    playButton.disabled = !state.paused
    pauseButton.disabled = state.paused
  }

  function setSeedEnabled(enabled) {
    state.seedEnabled = Boolean(enabled)
    seedToggle.input.checked = state.seedEnabled
  }

  function setSeed(seed) {
    state.seed = seed
    seedField.input.value = state.seed
  }

  function setSpeed(speed) {
    state.speed = clampSpeed(Number(speed), speedRange)
    speedField.input.value = String(state.speed)
    speedField.value.textContent = formatSpeed(state.speed)
  }

  function setNpcCount(count) {
    state.npcCount = normalizeNpcCount(count, npcCountRange)
    npcCountField.slider.value = String(state.npcCount)
    npcCountField.input.value = String(state.npcCount)
  }

  function setCarCount(count) {
    state.carCount = normalizeCarCount(count, carCountRange)
    carCountField.slider.value = String(state.carCount)
    carCountField.input.value = String(state.carCount)
  }

  function setDayNightOverlayEnabled(enabled) {
    state.dayNightOverlayEnabled = Boolean(enabled)
    dayNightToggle.input.checked = state.dayNightOverlayEnabled
  }

  function setInitialInfectiousCount(count) {
    state.initialInfectiousCount = normalizeInitialInfectiousCount(count, initialInfectiousCountRange)
    initialInfectiousCountField.input.value = String(state.initialInfectiousCount)
  }

  function setInfectionDistance(distance) {
    state.infectionDistance = normalizeInfectionDistance(distance, infectionDistanceRange)
    infectionDistanceField.input.value = formatNumberInput(state.infectionDistance)
  }

  function setInfectionProbability(probability) {
    state.infectionProbability = normalizeInfectionProbability(probability, infectionProbabilityRange)
    infectionProbabilityField.input.value = formatNumberInput(state.infectionProbability)
  }

  function setIncubationDays(days) {
    state.incubationDays = normalizeIncubationDays(days, incubationDaysRange)
    incubationDaysField.input.value = formatNumberInput(state.incubationDays)
  }

  function setInfectionDays(days) {
    state.infectionDays = normalizeInfectionDays(days, infectionDaysRange)
    infectionDaysField.input.value = formatNumberInput(state.infectionDays)
  }

  function setImmunityDays(days) {
    state.immunityDays = normalizeImmunityDays(days, immunityDaysRange)
    immunityDaysField.input.value = formatNumberInput(state.immunityDays)
  }

  function render() {
    clockField.value.textContent = formatClockDisplay(options.clock)
    infectionStatsField.value.textContent = formatInfectionStats(
      typeof options.getInfectionStats === 'function' ? options.getInfectionStats() : null
    )
  }

  setPaused(state.paused)
  setSeedEnabled(state.seedEnabled)
  setSeed(state.seed)
  setSpeed(state.speed)
  setNpcCount(state.npcCount)
  setCarCount(state.carCount)
  setDayNightOverlayEnabled(state.dayNightOverlayEnabled)
  setInitialInfectiousCount(state.initialInfectiousCount)
  setInfectionDistance(state.infectionDistance)
  setInfectionProbability(state.infectionProbability)
  setIncubationDays(state.incubationDays)
  setInfectionDays(state.infectionDays)
  setImmunityDays(state.immunityDays)
  render()

  return {
    element: section,
    state,
    render,
    setPaused,
    setSeedEnabled,
    setSeed,
    setSpeed,
    setNpcCount,
    setCarCount,
    setDayNightOverlayEnabled,
    setInitialInfectiousCount,
    setInfectionDistance,
    setInfectionProbability,
    setIncubationDays,
    setInfectionDays,
    setImmunityDays,
    togglePlayback
  }
}

function createEpidemicGraph(options = {}) {
  const element = document.createElement('section')
  const controls = document.createElement('div')
  const plot = createSvgElement('svg')
  const defs = createSvgElement('defs')
  const clipPath = createSvgElement('clipPath')
  const clipRect = createSvgElement('rect')
  const plotArea = createSvgElement('rect')
  const grid = createSvgElement('g')
  const axis = createSvgElement('polyline')
  const ticks = createSvgElement('g')
  const dataLayer = createSvgElement('g')
  const labels = createSvgElement('g')
  const xAxisLabel = createSvgElement('text')
  const yAxisLabel = createSvgElement('text')
  const lines = new Map()
  const visibleStates = Object.fromEntries(EPIDEMIC_GRAPH_STATES.map((state) => [state.id, true]))
  const samples = []
  const view = {
    timeStartSeconds: null,
    timeEndSeconds: null
  }
  const plotLayout = getEpidemicGraphLayout()
  const plotBounds = plotLayout.bounds
  const clipId = `epidemic-graph-clip-${++epidemicGraphSequence}`
  let dragState = null
  let interactionsInstalled = false

  element.className = 'epidemic-graph'
  controls.className = 'epidemic-graph-controls'
  plot.setAttribute('class', 'epidemic-graph-plot')
  plot.dataset.epidemicGraphPlot = 'true'
  plot.setAttribute('viewBox', formatEpidemicGraphViewBox(plotLayout))
  plot.setAttribute('role', 'img')
  plot.setAttribute('preserveAspectRatio', 'none')
  plot.setAttribute('aria-label', 'Epidemic state counts over simulation time')
  clipPath.setAttribute('id', clipId)
  clipRect.setAttribute('x', formatSvgNumber(plotBounds.left))
  clipRect.setAttribute('y', formatSvgNumber(plotBounds.top))
  clipRect.setAttribute('width', formatSvgNumber(plotBounds.width))
  clipRect.setAttribute('height', formatSvgNumber(plotBounds.height))
  clipPath.appendChild(clipRect)
  defs.appendChild(clipPath)
  plotArea.setAttribute('class', 'epidemic-graph-plot-area')
  plotArea.setAttribute('x', formatSvgNumber(plotBounds.left))
  plotArea.setAttribute('y', formatSvgNumber(plotBounds.top))
  plotArea.setAttribute('width', formatSvgNumber(plotBounds.width))
  plotArea.setAttribute('height', formatSvgNumber(plotBounds.height))
  plotArea.setAttribute('fill', 'rgba(255, 255, 255, 0.72)')
  plotArea.setAttribute('stroke', 'rgba(32, 38, 29, 0.12)')
  plotArea.setAttribute('stroke-width', '1')
  plotArea.setAttribute('vector-effect', 'non-scaling-stroke')
  grid.setAttribute('class', 'epidemic-graph-grid')
  grid.dataset.epidemicGraphGrid = 'true'
  axis.setAttribute('class', 'epidemic-graph-axis')
  axis.dataset.epidemicGraphAxis = 'true'
  axis.setAttribute('points', createEpidemicGraphAxisPoints())
  axis.setAttribute('fill', 'none')
  axis.setAttribute('stroke', 'rgba(32, 38, 29, 0.62)')
  axis.setAttribute('stroke-width', '1')
  axis.setAttribute('vector-effect', 'non-scaling-stroke')
  ticks.setAttribute('class', 'epidemic-graph-ticks')
  ticks.dataset.epidemicGraphTicks = 'true'
  dataLayer.setAttribute('class', 'epidemic-graph-data')
  dataLayer.setAttribute('clip-path', `url(#${clipId})`)
  labels.setAttribute('class', 'epidemic-graph-axis-labels')
  xAxisLabel.setAttribute('class', 'epidemic-graph-axis-label')
  xAxisLabel.dataset.epidemicGraphXAxisLabel = 'true'
  xAxisLabel.setAttribute('x', formatSvgNumber(plotBounds.left + plotBounds.width / 2))
  xAxisLabel.setAttribute('y', formatSvgNumber(plotLayout.height - 4))
  xAxisLabel.setAttribute('text-anchor', 'middle')
  xAxisLabel.setAttribute('fill', 'rgba(32, 38, 29, 0.82)')
  xAxisLabel.setAttribute('font-size', '12')
  xAxisLabel.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
  xAxisLabel.setAttribute('font-weight', '700')
  xAxisLabel.setAttribute('pointer-events', 'none')
  xAxisLabel.textContent = 'time (h)'
  yAxisLabel.setAttribute('class', 'epidemic-graph-axis-label')
  yAxisLabel.dataset.epidemicGraphYAxisLabel = 'true'
  yAxisLabel.setAttribute('x', formatSvgNumber(-(plotBounds.top + plotBounds.height / 2)))
  yAxisLabel.setAttribute('y', '11')
  yAxisLabel.setAttribute('text-anchor', 'middle')
  yAxisLabel.setAttribute('transform', 'rotate(-90)')
  yAxisLabel.setAttribute('fill', 'rgba(32, 38, 29, 0.82)')
  yAxisLabel.setAttribute('font-size', '12')
  yAxisLabel.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
  yAxisLabel.setAttribute('font-weight', '700')
  yAxisLabel.setAttribute('pointer-events', 'none')
  yAxisLabel.textContent = 'cases'
  labels.appendChild(xAxisLabel)
  labels.appendChild(yAxisLabel)
  plot.appendChild(defs)
  plot.appendChild(plotArea)
  plot.appendChild(grid)
  plot.appendChild(dataLayer)
  plot.appendChild(axis)
  plot.appendChild(ticks)
  plot.appendChild(labels)

  for (const state of EPIDEMIC_GRAPH_STATES) {
    const toggle = createDashboardToggle({
      labelText: state.label,
      dataset: 'epidemicGraphToggle',
      datasetValue: state.id,
      checked: true
    })
    const line = createSvgElement('polyline')

    toggle.label.className = 'dashboard-toggle epidemic-graph-toggle'
    toggle.input.addEventListener('change', () => {
      setStateVisible(state.id, toggle.input.checked)
    })
    line.setAttribute('class', 'epidemic-graph-line')
    line.dataset.epidemicGraphLine = state.id
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', formatCssColor(state.color))
    line.setAttribute('stroke-width', '1.85')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('stroke-linejoin', 'round')
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    line.setAttribute('points', '')
    lines.set(state.id, line)
    controls.appendChild(toggle.label)
    dataLayer.appendChild(line)
  }

  element.appendChild(controls)
  element.appendChild(plot)

  function render() {
    sample()
    draw()
  }

  function sample() {
    const stats = normalizeEpidemicStats(
      typeof options.getInfectionStats === 'function' ? options.getInfectionStats() : null
    )

    if (!stats) {
      return
    }

    const seconds = getEpidemicGraphTimeSeconds(options.clock, samples)
    const last = samples[samples.length - 1]

    if (last && seconds < last.timeSeconds) {
      samples.length = 0
    }

    const currentLast = samples[samples.length - 1]

    if (!currentLast) {
      appendSample(seconds, stats)
      return
    }

    if (seconds === currentLast.timeSeconds) {
      Object.assign(currentLast, stats)
      return
    }

    if (
      seconds - currentLast.timeSeconds >= EPIDEMIC_GRAPH_CONFIG.sampleIntervalSeconds ||
      hasEpidemicStatsChanged(currentLast, stats)
    ) {
      appendSample(seconds, stats)
    }
  }

  function appendSample(timeSeconds, stats) {
    samples.push({
      timeSeconds,
      ...stats
    })
  }

  function draw() {
    const layout = updateEpidemicGraphPlotLayout(plot, {
      clipRect,
      plotArea,
      axis,
      xAxisLabel,
      yAxisLabel
    })
    const ranges = getEpidemicGraphRanges(samples, view, visibleStates)
    const pointsByState = buildEpidemicGraphPoints(samples, ranges, layout)

    drawEpidemicGraphAxes(grid, ticks, ranges, layout)

    for (const state of EPIDEMIC_GRAPH_STATES) {
      const line = lines.get(state.id)
      const points = visibleStates[state.id] ? pointsByState[state.id] : ''

      line.setAttribute('points', points)
    }
  }

  function setStateVisible(stateId, visible) {
    if (!Object.prototype.hasOwnProperty.call(visibleStates, stateId)) {
      throw new Error(`Unknown epidemic graph state "${stateId}".`)
    }

    visibleStates[stateId] = Boolean(visible)
    draw()
  }

  function installInteractions() {
    if (interactionsInstalled) {
      return
    }

    interactionsInstalled = true
    plot.addEventListener('wheel', handleWheel, { passive: false })
    plot.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
  }

  function handleWheel(event) {
    if (samples.length === 0) {
      return
    }

    event.preventDefault()

    const ranges = getEpidemicGraphRanges(samples, view, visibleStates)
    const pointer = getEpidemicGraphPointerFractions(plot, event)
    const zoomScale = Math.exp((Number(event.deltaY) || 0) * 0.001)
    const timeRange = zoomRange(
      ranges.timeStartSeconds,
      ranges.timeEndSeconds,
      pointer.x,
      zoomScale,
      EPIDEMIC_GRAPH_CONFIG.minTimeSpanSeconds
    )
    const nextTimeRange = normalizeEpidemicGraphTimeRange(timeRange.start, timeRange.end)

    setEpidemicGraphView(view, {
      timeStartSeconds: nextTimeRange.timeStartSeconds,
      timeEndSeconds: nextTimeRange.timeEndSeconds
    })
    draw()
  }

  function handlePointerDown(event) {
    if (samples.length === 0 || Number(event.button || 0) !== 0) {
      return
    }

    event.preventDefault()
    dragState = {
      pointerId: event.pointerId,
      clientX: Number(event.clientX) || 0,
      ranges: getEpidemicGraphRanges(samples, view, visibleStates)
    }

    setElementPointerCapture(plot, event.pointerId)
  }

  function handlePointerMove(event) {
    if (!dragState || (Number.isFinite(dragState.pointerId) && event.pointerId !== dragState.pointerId)) {
      return
    }

    event.preventDefault()

    const plotWidth = getEpidemicGraphPlotDisplayWidth(plot)
    const dx = (Number(event.clientX) || 0) - dragState.clientX
    const ranges = dragState.ranges
    const timeSpan = ranges.timeEndSeconds - ranges.timeStartSeconds
    const timeShift = -dx / plotWidth * timeSpan
    const nextTimeRange = normalizeEpidemicGraphTimeRange(
      ranges.timeStartSeconds + timeShift,
      ranges.timeEndSeconds + timeShift
    )

    setEpidemicGraphView(view, {
      timeStartSeconds: nextTimeRange.timeStartSeconds,
      timeEndSeconds: nextTimeRange.timeEndSeconds
    })
    draw()
  }

  function handlePointerUp(event) {
    if (!dragState || (Number.isFinite(dragState.pointerId) && event.pointerId !== dragState.pointerId)) {
      return
    }

    releaseElementPointerCapture(plot, dragState.pointerId)

    dragState = null
  }

  function destroy() {
    plot.removeEventListener('wheel', handleWheel)
    plot.removeEventListener('pointerdown', handlePointerDown)
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.removeEventListener('pointercancel', handlePointerUp)
  }

  return {
    element,
    plot,
    samples,
    visibleStates,
    view,
    installInteractions,
    render,
    setStateVisible,
    destroy
  }
}

function createDashboardButton(label, action) {
  const button = document.createElement('button')

  button.className = 'dashboard-button'
  button.type = 'button'
  button.dataset.simulationAction = action
  button.textContent = label

  return button
}

function createDashboardSubsectionTitle(titleText) {
  const title = document.createElement('div')

  title.className = 'dashboard-section-title dashboard-subsection-title'
  title.textContent = titleText

  return title
}

function createSeedToggle(enabled) {
  return createDashboardToggle({
    labelText: 'use seed',
    dataset: 'simulationSeedToggle',
    checked: enabled
  })
}

function createSeedField(seed) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')

  label.className = 'dashboard-field'
  text.textContent = 'random seed'
  input.type = 'text'
  input.value = seed
  input.autocomplete = 'off'
  input.spellcheck = false
  input.dataset.simulationSeed = 'true'

  label.appendChild(text)
  label.appendChild(input)

  return { label, input }
}

function createClockField() {
  const label = document.createElement('div')
  const text = document.createElement('span')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-clock-field'
  text.textContent = 'time'
  value.className = 'dashboard-clock-value'
  value.dataset.simulationClock = 'true'
  label.appendChild(text)
  label.appendChild(value)

  return { label, value }
}

function createSpeedField(speed, speedRange) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-slider-field'
  text.textContent = 'speed'
  input.type = 'range'
  input.min = String(speedRange.min)
  input.max = String(speedRange.max)
  input.step = String(speedRange.step)
  input.value = String(clampSpeed(speed, speedRange))
  input.dataset.simulationSpeed = 'true'
  value.className = 'dashboard-speed-value'
  value.textContent = formatSpeed(Number(input.value))
  label.appendChild(text)
  label.appendChild(input)
  label.appendChild(value)

  return { label, input, value }
}

function createNpcCountField(count, countRange) {
  return createCountField({
    labelText: 'NPCs',
    className: 'dashboard-npc-count-field',
    sliderDataset: 'simulationNpcCountSlider',
    inputDataset: 'simulationNpcCount',
    count,
    countRange,
    normalize: normalizeNpcCount
  })
}

function createCarCountField(count, countRange) {
  return createCountField({
    labelText: 'cars',
    className: 'dashboard-car-count-field',
    sliderDataset: 'simulationCarCountSlider',
    inputDataset: 'simulationCarCount',
    count,
    countRange,
    normalize: normalizeCarCount
  })
}

function createCountField({ labelText, className, sliderDataset, inputDataset, count, countRange, normalize }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const controls = document.createElement('div')
  const slider = document.createElement('input')
  const input = document.createElement('input')

  label.className = `dashboard-field ${className}`
  text.textContent = labelText
  controls.className = 'dashboard-paired-inputs'
  slider.type = 'range'
  slider.min = String(countRange.min)
  slider.max = String(countRange.max)
  slider.step = String(countRange.step)
  slider.value = String(normalize(count, countRange))
  slider.dataset[sliderDataset] = 'true'
  input.type = 'number'
  input.min = String(countRange.min)
  input.max = String(countRange.max)
  input.step = '1'
  input.value = String(normalize(count, countRange))
  input.dataset[inputDataset] = 'true'
  controls.appendChild(slider)
  controls.appendChild(input)
  label.appendChild(text)
  label.appendChild(controls)

  return { label, slider, input }
}

function createDayNightToggle(enabled) {
  return createDashboardToggle({
    labelText: 'day-night overlay',
    dataset: 'simulationDayNightToggle',
    checked: enabled
  })
}

function createInfectionStatsField() {
  const label = document.createElement('div')
  const text = document.createElement('span')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-infection-stats-field'
  text.textContent = 'SEIR'
  value.className = 'dashboard-infection-stats-value'
  value.dataset.simulationInfectionStats = 'true'
  label.appendChild(text)
  label.appendChild(value)

  return { label, value }
}

function createInitialInfectiousCountField(count, range) {
  return createNumberField({
    labelText: 'initial infected',
    className: 'dashboard-initial-infectious-count-field',
    dataset: 'simulationInitialInfectiousCount',
    value: count,
    range,
    normalize: normalizeInitialInfectiousCount,
    format: String
  })
}

function createInfectionDistanceField(distance, range) {
  return createNumberField({
    labelText: 'infect dist',
    className: 'dashboard-infection-distance-field',
    dataset: 'simulationInfectionDistance',
    value: distance,
    range,
    normalize: normalizeInfectionDistance
  })
}

function createInfectionProbabilityField(probability, range) {
  return createNumberField({
    labelText: 'infect p/min',
    className: 'dashboard-infection-probability-field',
    dataset: 'simulationInfectionProbability',
    value: probability,
    range,
    normalize: normalizeInfectionProbability
  })
}

function createIncubationDaysField(days, range) {
  return createNumberField({
    labelText: 'incub days',
    className: 'dashboard-incubation-days-field',
    dataset: 'simulationIncubationDays',
    value: days,
    range,
    normalize: normalizeIncubationDays
  })
}

function createInfectionDaysField(days, range) {
  return createNumberField({
    labelText: 'infect days',
    className: 'dashboard-infection-days-field',
    dataset: 'simulationInfectionDays',
    value: days,
    range,
    normalize: normalizeInfectionDays
  })
}

function createImmunityDaysField(days, range) {
  return createNumberField({
    labelText: 'immune days',
    className: 'dashboard-immunity-days-field',
    dataset: 'simulationImmunityDays',
    value: days,
    range,
    normalize: normalizeImmunityDays
  })
}

function createNumberField({ labelText, className, dataset, value, range, normalize, format = formatNumberInput }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')

  label.className = `dashboard-field ${className}`
  text.textContent = labelText
  input.type = 'number'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
  input.value = format(normalize(value, range))
  input.dataset[dataset] = 'true'
  label.appendChild(text)
  label.appendChild(input)

  return { label, input }
}

function normalizeSpeedRange(range) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isFinite(min) && Number.isFinite(max) && max >= min && Number.isFinite(step) && step > 0) {
    return { min, max, step }
  }

  return { min: 1, max: 24, step: 0.25 }
}

function normalizeNpcCountRange(range) {
  return normalizeIntegerRange(range, { min: 100, max: 10000, step: 100 })
}

function normalizeCarCountRange(range) {
  return normalizeIntegerRange(range, { min: 0, max: 2000, step: 10 })
}

function normalizeInitialInfectiousCountRange(range) {
  return normalizeIntegerRange(range, { min: 0, max: 10000, step: 1 })
}

function normalizeInfectionDistanceRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 256, step: 1 })
}

function normalizeInfectionProbabilityRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 1, step: 0.01 })
}

function normalizeIncubationDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 14, step: 0.25 })
}

function normalizeInfectionDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 21, step: 0.25 })
}

function normalizeImmunityDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 365, step: 1 })
}

function normalizeIntegerRange(range, fallback) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isInteger(min) && min >= 0 && Number.isInteger(max) && max >= min && Number.isInteger(step) && step > 0) {
    return { min, max, step }
  }

  return fallback
}

function normalizeNumberRange(range, fallback) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isFinite(min) && min >= 0 && Number.isFinite(max) && max >= min && Number.isFinite(step) && step > 0) {
    return { min, max, step }
  }

  return fallback
}

function normalizeNpcCount(count, range) {
  const countRange = normalizeNpcCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeCarCount(count, range) {
  const countRange = normalizeCarCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeInitialInfectiousCount(count, range) {
  const countRange = normalizeInitialInfectiousCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeInfectionDistance(distance, range) {
  return normalizeNumberInRange(distance, normalizeInfectionDistanceRange(range))
}

function normalizeInfectionProbability(probability, range) {
  return normalizeNumberInRange(probability, normalizeInfectionProbabilityRange(range))
}

function normalizeIncubationDays(days, range) {
  return normalizeNumberInRange(days, normalizeIncubationDaysRange(range))
}

function normalizeInfectionDays(days, range) {
  return normalizeNumberInRange(days, normalizeInfectionDaysRange(range))
}

function normalizeImmunityDays(days, range) {
  return normalizeNumberInRange(days, normalizeImmunityDaysRange(range))
}

function normalizeNumberInRange(value, range) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return range.min
  }

  return Math.min(Math.max(number, range.min), range.max)
}

function clampSpeed(speed, range) {
  if (!Number.isFinite(speed)) {
    return range.min
  }

  return Math.min(Math.max(speed, range.min), range.max)
}

function formatSpeed(speed) {
  return `${Number(speed.toFixed(2))}x`
}

function formatNumberInput(value) {
  return String(Number(value.toFixed(4)))
}

function formatClockDisplay(clock) {
  if (!clock || typeof clock.formatTimeOfDay !== 'function') {
    return '--:--'
  }

  const dayIndex = typeof clock.getDayIndex === 'function' ? clock.getDayIndex() : 0

  return `day ${dayIndex + 1} ${clock.formatTimeOfDay()}`
}

function formatInfectionStats(stats) {
  if (!stats) {
    return 'S 0 E 0 I 0 R 0'
  }

  return `S ${formatStatCount(stats.susceptible)} E ${formatStatCount(stats.exposed)} I ${formatStatCount(stats.infectious)} R ${formatStatCount(stats.recovered)}`
}

function formatStatCount(count) {
  const value = Math.round(Number(count))

  return Number.isFinite(value) && value >= 0 ? value : 0
}

function createOverlayToggle(overlay) {
  return createDashboardToggle({
    labelText: overlay.label,
    dataset: 'overlayToggle',
    datasetValue: overlay.id,
    checked: false
  })
}

function createDashboardToggle({ labelText, dataset, datasetValue = 'true', checked = false }) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  const text = document.createElement('span')

  label.className = 'dashboard-toggle'
  input.type = 'checkbox'
  input.dataset[dataset] = datasetValue
  input.checked = Boolean(checked)
  text.textContent = labelText

  label.appendChild(input)
  label.appendChild(text)

  return { label, input }
}

function createMapTextureToggle(enabled) {
  return createDashboardToggle({
    labelText: 'map texture',
    dataset: 'mapTextureToggle',
    checked: enabled
  })
}

function createMapTextureOpacityField(opacity) {
  return createRenderingOpacityField({
    labelText: 'texture opacity',
    inputDataset: 'mapTextureOpacity',
    valueDataset: 'mapTextureOpacityValue',
    opacity,
    opacityRange: RENDERING_OPACITY_RANGE,
    normalize: normalizeRenderingOpacity
  })
}

function createTileOverlaySchemeField(schemeId) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const select = document.createElement('select')
  const normalizedSchemeId = normalizeTileOverlayScheme(schemeId)

  label.className = 'dashboard-field'
  text.textContent = 'color scheme'
  select.dataset.tileOverlayScheme = 'true'

  for (const scheme of TILE_TYPE_OVERLAY_SCHEME_OPTIONS) {
    const option = document.createElement('option')

    option.value = scheme.id
    option.textContent = scheme.label
    select.appendChild(option)
  }

  select.value = normalizedSchemeId
  label.appendChild(text)
  label.appendChild(select)

  return { label, select }
}

function createEntityRenderModeField(mode) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const select = document.createElement('select')
  const normalizedMode = normalizeEntityRenderMode(mode)

  label.className = 'dashboard-field'
  text.textContent = 'rendering'
  select.dataset.entityRenderMode = 'true'

  for (const option of ENTITY_RENDER_MODE_OPTIONS) {
    const item = document.createElement('option')

    item.value = option.id
    item.textContent = option.label
    select.appendChild(item)
  }

  select.value = normalizedMode
  label.appendChild(text)
  label.appendChild(select)

  return { label, select }
}

function createInfectionEdgeDurationField(durationMinutes, durationRange) {
  return createPairedRangeNumberField({
    labelText: 'infect edge min',
    className: 'dashboard-infection-edge-duration-field',
    sliderDataset: 'infectionEdgeDurationSlider',
    inputDataset: 'infectionEdgeDuration',
    value: durationMinutes,
    range: durationRange,
    normalize: normalizeInfectionEdgeDuration,
    inputFormat: formatNumberInput
  })
}

function createContactEdgeDurationField(durationMinutes, durationRange) {
  return createPairedRangeNumberField({
    labelText: 'contact edge min',
    className: 'dashboard-contact-edge-duration-field',
    sliderDataset: 'contactEdgeDurationSlider',
    inputDataset: 'contactEdgeDuration',
    value: durationMinutes,
    range: durationRange,
    normalize: normalizeContactEdgeDuration,
    inputFormat: formatNumberInput
  })
}

function createPathTrailLengthField(length, lengthRange) {
  return createPairedRangeNumberField({
    labelText: 'trail steps',
    className: 'dashboard-path-trail-length-field',
    sliderDataset: 'pathTrailLengthSlider',
    inputDataset: 'pathTrailLength',
    value: length,
    range: lengthRange,
    normalize: normalizePathTrailLength,
    inputFormat: String
  })
}

function createPairedRangeNumberField({ labelText, className, sliderDataset, inputDataset, value, range, normalize, inputFormat }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const controls = document.createElement('div')
  const slider = document.createElement('input')
  const input = document.createElement('input')
  const normalizedValue = normalize(value, range)

  label.className = `dashboard-field ${className}`
  text.textContent = labelText
  controls.className = 'dashboard-paired-inputs'
  slider.type = 'range'
  slider.min = String(range.min)
  slider.max = String(range.max)
  slider.step = String(range.step)
  slider.value = String(normalizedValue)
  slider.dataset[sliderDataset] = 'true'
  input.type = 'number'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
  input.value = inputFormat(normalizedValue)
  input.dataset[inputDataset] = 'true'

  controls.appendChild(slider)
  controls.appendChild(input)
  label.appendChild(text)
  label.appendChild(controls)

  return { label, slider, input }
}

function createTileTypeOverlayOpacityField(opacity, opacityRange) {
  return createRenderingOpacityField({
    labelText: 'tile opacity',
    inputDataset: 'tileTypeOverlayOpacity',
    valueDataset: 'tileTypeOverlayOpacityValue',
    opacity,
    opacityRange,
    normalize: normalizeTileTypeOverlayOpacity
  })
}

function createHeatmapRadiusField(radius, radiusRange) {
  return createPairedRangeNumberField({
    labelText: 'radius',
    className: 'dashboard-heatmap-radius-field',
    sliderDataset: 'heatmapRadiusSlider',
    inputDataset: 'heatmapRadius',
    value: radius,
    range: radiusRange,
    normalize: normalizeHeatmapRadius,
    inputFormat: formatNumberInput
  })
}

function createRenderingOpacityField({ labelText, inputDataset, valueDataset, opacity, opacityRange, normalize }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')
  const value = document.createElement('output')
  const normalizedOpacity = normalize(opacity)

  label.className = 'dashboard-field dashboard-slider-field'
  text.textContent = labelText
  input.type = 'range'
  input.min = String(opacityRange.min)
  input.max = String(opacityRange.max)
  input.step = String(opacityRange.step)
  input.value = String(normalizedOpacity)
  input.dataset[inputDataset] = 'true'
  value.className = 'dashboard-opacity-value'
  value.dataset[valueDataset] = 'true'
  value.textContent = formatOpacity(normalizedOpacity)

  label.appendChild(text)
  label.appendChild(input)
  label.appendChild(value)

  return { label, input, value }
}

function createSvgElement(tagName) {
  if (typeof document.createElementNS === 'function') {
    return document.createElementNS(SVG_NAMESPACE, tagName)
  }

  return document.createElement(tagName)
}

function createEpidemicGraphAxisPoints(layout = getEpidemicGraphLayout()) {
  const { left, right, top, bottom } = layout.bounds

  return `${formatSvgNumber(left)},${formatSvgNumber(top)} ${formatSvgNumber(left)},${formatSvgNumber(bottom)} ${formatSvgNumber(right)},${formatSvgNumber(bottom)}`
}

function getEpidemicGraphLayout(plot = null) {
  const rect = plot ? getElementRect(plot) : null
  const width = rect && rect.width > 0 ? rect.width : EPIDEMIC_GRAPH_CONFIG.width
  const height = rect && rect.height > 0 ? rect.height : EPIDEMIC_GRAPH_CONFIG.height

  return {
    width,
    height,
    bounds: getEpidemicGraphPlotBounds(width, height)
  }
}

function formatEpidemicGraphViewBox(layout) {
  return `0 0 ${formatSvgNumber(layout.width)} ${formatSvgNumber(layout.height)}`
}

function getEpidemicGraphPlotBounds(width = EPIDEMIC_GRAPH_CONFIG.width, height = EPIDEMIC_GRAPH_CONFIG.height) {
  const { padding } = EPIDEMIC_GRAPH_CONFIG
  const left = padding.left
  const top = padding.top
  const right = Math.max(left + 1, width - padding.right)
  const bottom = Math.max(top + 1, height - padding.bottom)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function updateEpidemicGraphPlotLayout(plot, elements) {
  const layout = getEpidemicGraphLayout(plot)
  const bounds = layout.bounds

  plot.setAttribute('viewBox', formatEpidemicGraphViewBox(layout))
  elements.clipRect.setAttribute('x', formatSvgNumber(bounds.left))
  elements.clipRect.setAttribute('y', formatSvgNumber(bounds.top))
  elements.clipRect.setAttribute('width', formatSvgNumber(bounds.width))
  elements.clipRect.setAttribute('height', formatSvgNumber(bounds.height))
  elements.plotArea.setAttribute('x', formatSvgNumber(bounds.left))
  elements.plotArea.setAttribute('y', formatSvgNumber(bounds.top))
  elements.plotArea.setAttribute('width', formatSvgNumber(bounds.width))
  elements.plotArea.setAttribute('height', formatSvgNumber(bounds.height))
  elements.axis.setAttribute('points', createEpidemicGraphAxisPoints(layout))
  elements.xAxisLabel.setAttribute('x', formatSvgNumber(bounds.left + bounds.width / 2))
  elements.xAxisLabel.setAttribute('y', formatSvgNumber(layout.height - 4))
  elements.yAxisLabel.setAttribute('x', formatSvgNumber(-(bounds.top + bounds.height / 2)))

  return layout
}

function normalizeEpidemicStats(stats) {
  if (!stats) {
    return null
  }

  const normalized = {}

  for (const state of EPIDEMIC_GRAPH_STATES) {
    const count = Math.max(0, Math.round(Number(stats[state.id]) || 0))

    normalized[state.id] = count
  }

  return normalized
}

function getEpidemicGraphTimeSeconds(clock, samples) {
  if (clock && typeof clock.getElapsedSimulationSeconds === 'function') {
    const seconds = Number(clock.getElapsedSimulationSeconds())

    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds)
    }
  }

  const last = samples[samples.length - 1]

  return last ? last.timeSeconds + EPIDEMIC_GRAPH_CONFIG.sampleIntervalSeconds : 0
}

function hasEpidemicStatsChanged(sample, stats) {
  return EPIDEMIC_GRAPH_STATES.some((state) => sample[state.id] !== stats[state.id])
}

function getEpidemicGraphRanges(samples, view = {}, visibleStates = null) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dataStart = first ? first.timeSeconds : 0
  const dataEnd = last ? Math.max(last.timeSeconds, dataStart + 1) : 1
  const timeRange = normalizeEpidemicGraphTimeRange(
    Number.isFinite(view.timeStartSeconds) ? view.timeStartSeconds : dataStart,
    Number.isFinite(view.timeEndSeconds) ? view.timeEndSeconds : dataEnd
  )
  const visibleSamples = samples.filter((sample) => (
    sample.timeSeconds >= timeRange.timeStartSeconds &&
    sample.timeSeconds <= timeRange.timeEndSeconds
  ))
  const valueSamples = visibleSamples.length > 0 ? visibleSamples : samples
  const valueStates = EPIDEMIC_GRAPH_STATES.filter((state) => (
    !visibleStates || visibleStates[state.id] !== false
  ))
  const rangeStates = valueStates.length > 0 ? valueStates : EPIDEMIC_GRAPH_STATES
  const dataMax = Math.max(
    1,
    ...valueSamples.flatMap((sample) => rangeStates.map((state) => sample[state.id]))
  )

  return {
    timeStartSeconds: timeRange.timeStartSeconds,
    timeEndSeconds: timeRange.timeEndSeconds,
    valueMin: 0,
    valueMax: getNiceEpidemicGraphValueMax(dataMax)
  }
}

function setEpidemicGraphView(view, next) {
  const timeRange = normalizeEpidemicGraphTimeRange(next.timeStartSeconds, next.timeEndSeconds)

  view.timeStartSeconds = timeRange.timeStartSeconds
  view.timeEndSeconds = timeRange.timeEndSeconds
}

function normalizeEpidemicGraphTimeRange(start, end) {
  const safeStart = Number.isFinite(Number(start)) ? Number(start) : 0
  const safeEnd = Number.isFinite(Number(end)) ? Number(end) : safeStart + EPIDEMIC_GRAPH_CONFIG.minTimeSpanSeconds
  const span = Math.max(EPIDEMIC_GRAPH_CONFIG.minTimeSpanSeconds, safeEnd - safeStart)
  const timeStartSeconds = Math.max(0, safeStart)

  return {
    timeStartSeconds,
    timeEndSeconds: timeStartSeconds + span
  }
}

function getNiceEpidemicGraphValueMax(value) {
  const safeValue = Math.max(EPIDEMIC_GRAPH_CONFIG.minValueSpan, Number(value) || 0)

  if (safeValue <= 5) {
    return Math.ceil(safeValue)
  }

  const step = getNiceEpidemicGraphStep(safeValue / 4)

  return Math.max(EPIDEMIC_GRAPH_CONFIG.minValueSpan, Math.ceil(safeValue / step) * step)
}

function getNiceEpidemicGraphStep(rawStep) {
  const safeStep = Math.max(Number(rawStep) || 0, Number.EPSILON)
  const magnitude = 10 ** Math.floor(Math.log10(safeStep))
  const normalized = safeStep / magnitude
  const multiplier = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10

  return multiplier * magnitude
}

function drawEpidemicGraphAxes(grid, ticks, ranges, layout = getEpidemicGraphLayout()) {
  grid.innerHTML = ''
  ticks.innerHTML = ''

  const bounds = layout.bounds
  const timeSpan = Math.max(EPIDEMIC_GRAPH_CONFIG.minTimeSpanSeconds, ranges.timeEndSeconds - ranges.timeStartSeconds)
  const valueSpan = Math.max(EPIDEMIC_GRAPH_CONFIG.minValueSpan, ranges.valueMax - ranges.valueMin)
  const timeTicks = createEpidemicGraphTicks(ranges.timeStartSeconds, ranges.timeEndSeconds, 5)
  const valueTicks = createEpidemicGraphValueTicks(ranges.valueMax)

  for (const value of valueTicks) {
    const valueAmount = (value - ranges.valueMin) / valueSpan
    const y = bounds.top + (1 - valueAmount) * bounds.height

    appendEpidemicGraphLine(grid, bounds.left, y, bounds.right, y, 'rgba(32, 38, 29, 0.1)', '1')
    appendEpidemicGraphLine(ticks, bounds.left - 4, y, bounds.left, y, 'rgba(32, 38, 29, 0.62)', '1')
    appendEpidemicGraphText(ticks, bounds.left - 7, y, formatEpidemicGraphValueTick(value), {
      anchor: 'end',
      baseline: 'middle'
    })
  }

  for (const value of timeTicks) {
    const timeAmount = (value - ranges.timeStartSeconds) / timeSpan
    const x = bounds.left + timeAmount * bounds.width

    appendEpidemicGraphLine(grid, x, bounds.top, x, bounds.bottom, 'rgba(32, 38, 29, 0.08)', '1')
    appendEpidemicGraphLine(ticks, x, bounds.bottom, x, bounds.bottom + 4, 'rgba(32, 38, 29, 0.62)', '1')
    appendEpidemicGraphText(ticks, x, bounds.bottom + 13, formatEpidemicGraphTimeTick(value), {
      anchor: 'middle',
      baseline: 'middle'
    })
  }
}

function createEpidemicGraphTicks(start, end, count) {
  const safeCount = Math.max(2, Math.round(Number(count) || 2))
  const safeStart = Number(start) || 0
  const span = Math.max(Number(end) - safeStart, Number.EPSILON)

  return Array.from({ length: safeCount }, (_item, index) => safeStart + span * index / (safeCount - 1))
}

function createEpidemicGraphValueTicks(maxValue) {
  const safeMax = Math.max(EPIDEMIC_GRAPH_CONFIG.minValueSpan, Number(maxValue) || 0)
  const step = safeMax <= 5 ? 1 : getNiceEpidemicGraphStep(safeMax / 4)
  const ticks = []

  for (let value = 0; value <= safeMax + step * 0.5; value += step) {
    ticks.push(value)
  }

  if (ticks[ticks.length - 1] < safeMax) {
    ticks.push(safeMax)
  }

  return ticks
}

function appendEpidemicGraphLine(parent, x1, y1, x2, y2, stroke, strokeWidth) {
  const line = createSvgElement('line')

  line.setAttribute('x1', formatSvgNumber(x1))
  line.setAttribute('y1', formatSvgNumber(y1))
  line.setAttribute('x2', formatSvgNumber(x2))
  line.setAttribute('y2', formatSvgNumber(y2))
  line.setAttribute('stroke', stroke)
  line.setAttribute('stroke-width', strokeWidth)
  line.setAttribute('vector-effect', 'non-scaling-stroke')
  parent.appendChild(line)
}

function appendEpidemicGraphText(parent, x, y, text, options = {}) {
  const label = createSvgElement('text')

  label.setAttribute('x', formatSvgNumber(x))
  label.setAttribute('y', formatSvgNumber(y))
  label.setAttribute('fill', 'rgba(32, 38, 29, 0.72)')
  label.setAttribute('font-size', '11')
  label.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace')
  label.setAttribute('text-anchor', options.anchor || 'middle')
  label.setAttribute('dominant-baseline', options.baseline || 'auto')
  label.setAttribute('pointer-events', 'none')
  label.textContent = text
  parent.appendChild(label)
}

function formatEpidemicGraphTimeTick(seconds) {
  return formatCompactGraphNumber((Number(seconds) || 0) / 3600)
}

function formatEpidemicGraphValueTick(value) {
  return formatCompactGraphNumber(value)
}

function formatCompactGraphNumber(value) {
  const number = Number(value) || 0

  if (Math.abs(number - Math.round(number)) < 0.001) {
    return String(Math.round(number))
  }

  if (Math.abs(number) >= 10) {
    return number.toFixed(1).replace(/\.0$/, '')
  }

  return number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function getEpidemicGraphPlotDisplayWidth(plot) {
  const rect = getElementRect(plot)
  const layout = getEpidemicGraphLayout(plot)
  const bounds = layout.bounds

  return Math.max(1, rect.width * bounds.width / layout.width)
}

function setElementPointerCapture(element, pointerId) {
  if (!element || typeof element.setPointerCapture !== 'function' || !Number.isFinite(pointerId)) {
    return
  }

  try {
    element.setPointerCapture(pointerId)
  } catch (_error) {
    // Browser-created PointerEvents can lack an active pointer during scripted smoke checks.
  }
}

function releaseElementPointerCapture(element, pointerId) {
  if (!element || typeof element.releasePointerCapture !== 'function' || !Number.isFinite(pointerId)) {
    return
  }

  try {
    element.releasePointerCapture(pointerId)
  } catch (_error) {
    // Matching the capture guard keeps cleanup quiet for synthetic pointer events.
  }
}

function getEpidemicGraphPointerFractions(plot, event) {
  const rect = getElementRect(plot)
  const layout = getEpidemicGraphLayout(plot)
  const bounds = layout.bounds
  const viewBoxX = rect.width > 0
    ? (Number(event.clientX) - rect.left) / rect.width * layout.width
    : bounds.left + bounds.width / 2
  const viewBoxY = rect.height > 0
    ? (Number(event.clientY) - rect.top) / rect.height * layout.height
    : bounds.top + bounds.height / 2
  const x = bounds.width > 0
    ? (viewBoxX - bounds.left) / bounds.width
    : 0.5
  const y = bounds.height > 0
    ? (viewBoxY - bounds.top) / bounds.height
    : 0.5

  return {
    x: Math.min(Math.max(Number.isFinite(x) ? x : 0.5, 0), 1),
    y: Math.min(Math.max(Number.isFinite(y) ? y : 0.5, 0), 1)
  }
}

function getElementRect(element) {
  if (element && typeof element.getBoundingClientRect === 'function') {
    const rect = element.getBoundingClientRect()

    if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
      return rect
    }
  }

  return {
    left: 0,
    top: 0,
    width: EPIDEMIC_GRAPH_CONFIG.width,
    height: EPIDEMIC_GRAPH_CONFIG.height
  }
}

function zoomRange(start, end, anchorAmount, scale, minSpan) {
  const safeStart = Number(start)
  const safeEnd = Number(end)
  const span = Math.max(minSpan, safeEnd - safeStart)
  const nextSpan = Math.max(minSpan, span * Math.max(0.05, Number(scale) || 1))
  const anchor = Math.min(Math.max(Number(anchorAmount) || 0.5, 0), 1)
  const anchorValue = safeStart + anchor * span

  return {
    start: anchorValue - anchor * nextSpan,
    end: anchorValue + (1 - anchor) * nextSpan
  }
}

function getGraphResizeBounds() {
  const viewportWidth = Number(globalThis.innerWidth || globalThis.window?.innerWidth)
  const viewportHeight = Number(globalThis.innerHeight || globalThis.window?.innerHeight)
  const minWidth = 260
  const minHeight = 190
  const maxWidth = Number.isFinite(viewportWidth) ? Math.max(minWidth, viewportWidth - 32) : 4096
  const maxHeight = Number.isFinite(viewportHeight) ? Math.max(minHeight, viewportHeight - 32) : 4096

  return {
    minWidth,
    minHeight,
    maxWidth,
    maxHeight
  }
}

function buildEpidemicGraphPoints(samples, ranges, layout = getEpidemicGraphLayout()) {
  const points = Object.fromEntries(EPIDEMIC_GRAPH_STATES.map((state) => [state.id, '']))

  if (samples.length === 0) {
    return points
  }

  const bounds = layout.bounds
  const timeSpan = Math.max(EPIDEMIC_GRAPH_CONFIG.minTimeSpanSeconds, ranges.timeEndSeconds - ranges.timeStartSeconds)
  const valueSpan = Math.max(EPIDEMIC_GRAPH_CONFIG.minValueSpan, ranges.valueMax - ranges.valueMin)

  for (const state of EPIDEMIC_GRAPH_STATES) {
    points[state.id] = samples
      .map((sample) => {
        const timeAmount = (sample.timeSeconds - ranges.timeStartSeconds) / timeSpan
        const valueAmount = (sample[state.id] - ranges.valueMin) / valueSpan
        const x = bounds.left + timeAmount * bounds.width
        const y = bounds.top + (1 - valueAmount) * bounds.height

        return `${formatSvgNumber(x)},${formatSvgNumber(y)}`
      })
      .join(' ')
  }

  return points
}

function formatSvgNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}

function formatCssColor(color) {
  const number = Number.isInteger(color) ? color & 0xffffff : 0x20261d

  return `#${number.toString(16).padStart(6, '0')}`
}

function isTextEntryTarget(target) {
  if (!target || !target.tagName) {
    return false
  }

  if (target.isContentEditable || target.tagName === 'TEXTAREA') {
    return true
  }

  if (target.tagName !== 'INPUT') {
    return false
  }

  const type = String(target.type || 'text').toLowerCase()

  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit'
  ].includes(type)
}

function isInteractiveTarget(target) {
  if (!target || !target.tagName) {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

function findDashboardShortcutControl(root, target) {
  const activeElement = document.activeElement

  if (isDashboardControl(activeElement) && containsNode(root, activeElement)) {
    return activeElement
  }

  let node = target

  while (node && node !== root) {
    if (isDashboardControl(node)) {
      return node
    }

    node = node.parentNode
  }

  return isDashboardControl(root) ? root : null
}

function shouldReleaseDashboardShortcutFocus(control, eventType) {
  if (!control || isTextEntryTarget(control)) {
    return false
  }

  if (control.tagName === 'SELECT') {
    return eventType === 'change'
  }

  return eventType === 'click' || eventType === 'change'
}

function isDashboardControl(target) {
  return Boolean(
    target &&
    target.tagName &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
  )
}

function containsNode(root, node) {
  let current = node

  while (current) {
    if (current === root) {
      return true
    }

    current = current.parentNode
  }

  return false
}

function isSpaceHotkey(event) {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

function noop() {}

function normalizeRenderingOpacity(opacity) {
  const number = Number(opacity)

  if (!Number.isFinite(number)) {
    return 1
  }

  return Number(Math.min(Math.max(number, RENDERING_OPACITY_RANGE.min), RENDERING_OPACITY_RANGE.max).toFixed(4))
}

function normalizeHeatmapRadiusRange(range) {
  return normalizeNumberRange(range, SEIR_HEATMAP_CONFIG.radiusRange)
}

function normalizeHeatmapRadius(radius, range = SEIR_HEATMAP_CONFIG.radiusRange) {
  return Number(normalizeNumberInRange(radius, normalizeHeatmapRadiusRange(range)).toFixed(4))
}

function normalizeInfectionEdgeDurationRange(range) {
  return normalizeNumberRange(range, ENTITY_RENDER_DEBUG_CONFIG.infectionEdgeDurationRange)
}

function normalizeInfectionEdgeDuration(durationMinutes, range = ENTITY_RENDER_DEBUG_CONFIG.infectionEdgeDurationRange) {
  return Number(normalizeNumberInRange(durationMinutes, normalizeInfectionEdgeDurationRange(range)).toFixed(4))
}

function normalizeContactEdgeDurationRange(range) {
  return normalizeNumberRange(range, ENTITY_RENDER_DEBUG_CONFIG.contactEdgeDurationRange)
}

function normalizeContactEdgeDuration(durationMinutes, range = ENTITY_RENDER_DEBUG_CONFIG.contactEdgeDurationRange) {
  return Number(normalizeNumberInRange(durationMinutes, normalizeContactEdgeDurationRange(range)).toFixed(4))
}

function normalizePathTrailLengthRange(range) {
  return normalizeIntegerRange(range, ENTITY_RENDER_DEBUG_CONFIG.pathTrailLengthRange)
}

function normalizePathTrailLength(length, range = ENTITY_RENDER_DEBUG_CONFIG.pathTrailLengthRange) {
  return normalizeIntegerInRange(length, normalizePathTrailLengthRange(range))
}

function normalizeEntityRenderMode(mode) {
  const id = String(mode || '')

  return Object.prototype.hasOwnProperty.call(ENTITY_RENDER_MODES, id)
    ? id
    : ENTITY_RENDER_MODE_ID
}

function normalizeTileOverlayScheme(schemeId) {
  const id = String(schemeId || '')

  return Object.prototype.hasOwnProperty.call(TILE_TYPE_OVERLAY_COLOR_SCHEMES, id)
    ? id
    : TILE_TYPE_OVERLAY_SCHEME_ID
}

function normalizeTileTypeOverlayOpacity(opacity) {
  const range = TILE_TYPE_OVERLAY_COLORS.opacityRange
  const number = Number(opacity)

  if (!Number.isFinite(number)) {
    return TILE_TYPE_OVERLAY_COLORS.alpha
  }

  return Number(Math.min(Math.max(number, range.min), range.max).toFixed(4))
}

function normalizeIntegerInRange(value, range) {
  const number = Math.round(Number(value))

  if (!Number.isFinite(number)) {
    return range.min
  }

  return Math.min(Math.max(number, range.min), range.max)
}

function formatOpacity(opacity) {
  return `${Math.round(normalizeRenderingOpacity(opacity) * 100)}%`
}

function createOverlayLayer(entityLayer) {
  entityLayer.sortableChildren = true

  return {
    children: [],
    visible: true,
    addChild(child) {
      this.children.push(child)
      entityLayer.addChild(child)
    }
  }
}

function setOverlayLayerVisible(layer, visible) {
  layer.visible = visible

  for (const child of layer.children) {
    child.visible = visible
  }
}

function destroyOverlayLayer(layer) {
  for (const child of layer.children) {
    if (child.parent && typeof child.parent.removeChild === 'function') {
      child.parent.removeChild(child)
    }

    child.destroy({ children: true })
  }

  layer.children.length = 0
}

function ensureHeatmapGraphics(layer) {
  if (!layer.heatmapGraphics) {
    const graphics = new PIXI.Graphics()

    graphics.eventMode = 'none'
    graphics.zIndex = SEIR_HEATMAP_CONFIG.zorder
    graphics.zorder = SEIR_HEATMAP_CONFIG.zorder
    layer.heatmapGraphics = graphics
    layer.addChild(graphics)
  }

  return layer.heatmapGraphics
}

function drawHeatmapOverlay(city, layer, npcs, overlay, radius) {
  const graphics = ensureHeatmapGraphics(layer)
  const normalizedRadius = positiveHeatmapRadius(radius)
  const scratch = ensureHeatmapScratch(layer, city)

  clearHeatmapGraphics(graphics)

  if (normalizedRadius <= 0) {
    return
  }

  const maxDensity = accumulateHeatmapDensity(city, scratch, npcs, overlay.infection, normalizedRadius)

  if (maxDensity <= 0) {
    resetHeatmapScratch(scratch)
    return
  }

  const density = scratch.density
  const touched = scratch.touched
  const tileSize = city.tileSize
  const color = Number.isFinite(overlay.color) ? overlay.color : SEIR_HEATMAP_CONFIG.states[0].color
  const maxAlpha = SEIR_HEATMAP_CONFIG.alpha

  for (const index of touched) {
    const normalizedDensity = density[index] / maxDensity

    if (normalizedDensity < SEIR_HEATMAP_CONFIG.minimumNormalizedDensity) {
      continue
    }

    const x = index % city.width
    const y = Math.floor(index / city.width)
    const alpha = Number((maxAlpha * Math.sqrt(normalizedDensity)).toFixed(4))

    fillRect(graphics, x * tileSize, y * tileSize, tileSize, tileSize, color, alpha)
  }

  resetHeatmapScratch(scratch)
}

function ensureHeatmapScratch(layer, city) {
  const tileCount = city.width * city.height

  if (!layer.heatmapScratch || layer.heatmapScratch.density.length !== tileCount) {
    layer.heatmapScratch = {
      density: new Float32Array(tileCount),
      touched: []
    }
  }

  return layer.heatmapScratch
}

function accumulateHeatmapDensity(city, scratch, npcs, infection, radius) {
  const npcList = Array.isArray(npcs) ? npcs : []
  const density = scratch.density
  const touched = scratch.touched
  const tileSize = city.tileSize
  const halfTileSize = tileSize / 2
  const radiusSquared = radius * radius
  let maxDensity = 0

  touched.length = 0

  for (const npc of npcList) {
    if (!canUseNpcInHeatmap(npc, infection)) {
      continue
    }

    const position = npc.position
    const minX = Math.max(0, Math.floor((position.x - radius) / tileSize))
    const maxX = Math.min(city.width - 1, Math.floor((position.x + radius) / tileSize))
    const minY = Math.max(0, Math.floor((position.y - radius) / tileSize))
    const maxY = Math.min(city.height - 1, Math.floor((position.y + radius) / tileSize))

    for (let y = minY; y <= maxY; y += 1) {
      const cellCenterY = y * tileSize + halfTileSize
      const dy = cellCenterY - position.y

      for (let x = minX; x <= maxX; x += 1) {
        const cellCenterX = x * tileSize + halfTileSize
        const dx = cellCenterX - position.x
        const distanceSquared = dx * dx + dy * dy

        if (distanceSquared > radiusSquared) {
          continue
        }

        const normalizedDistanceSquared = distanceSquared / radiusSquared
        const kernel = (1 - normalizedDistanceSquared) * (1 - normalizedDistanceSquared)

        if (kernel <= 0) {
          continue
        }

        const index = y * city.width + x

        if (density[index] === 0) {
          touched.push(index)
        }

        density[index] += kernel
        maxDensity = Math.max(maxDensity, density[index])
      }
    }
  }

  return maxDensity
}

function groupHeatmapNpcsByInfection(npcs) {
  const groups = new Map(SEIR_HEATMAP_CONFIG.states.map((state) => [state.infection, []]))
  const npcList = Array.isArray(npcs) ? npcs : []

  for (const npc of npcList) {
    if (!hasUsableHeatmapPosition(npc)) {
      continue
    }

    const group = groups.get(npc.infection)

    if (group) {
      group.push(npc)
    }
  }

  return groups
}

function canUseNpcInHeatmap(npc, infection) {
  return npc && npc.infection === infection && hasUsableHeatmapPosition(npc)
}

function hasUsableHeatmapPosition(npc) {
  return Boolean(
    npc &&
    !npc.vehicleTrip &&
    npc.position &&
    Number.isFinite(npc.position.x) &&
    Number.isFinite(npc.position.y)
  )
}

function positiveHeatmapRadius(radius) {
  const value = Number(radius)

  return Number.isFinite(value) && value > 0 ? value : SEIR_HEATMAP_CONFIG.radius
}

function clearHeatmapGraphics(graphics) {
  if (typeof graphics.clear === 'function') {
    graphics.clear()
    return
  }

  if (Array.isArray(graphics.fills)) {
    graphics.fills.length = 0
  }
}

function resetHeatmapScratch(scratch) {
  for (const index of scratch.touched) {
    scratch.density[index] = 0
  }

  scratch.touched.length = 0
}

function drawTileTypeOverlay(city, layer, options) {
  const opacity = options && options.opacity
  const scheme = TILE_TYPE_OVERLAY_COLOR_SCHEMES[normalizeTileOverlayScheme(options && options.schemeId)]

  drawChunkedOverlay(city, layer, (graphics, x, y) => {
    const variant = city.getTileVariant(x, y)
    const alpha = normalizeTileTypeOverlayOpacity(opacity)

    if (variant.category === 'crosswalk') {
      drawCrosswalkTileTypeOverlay(graphics, city, x, y, alpha, scheme)
      return
    }

    fillRect(
      graphics,
      x * city.tileSize,
      y * city.tileSize,
      city.tileSize,
      city.tileSize,
      getTileTypeOverlayColor(variant, scheme),
      alpha
    )
  })
}

function getTileTypeOverlayColor(variant, scheme) {
  if (variant.category === 'building') {
    return getBuildingTypeOverlayColor(variant.buildingTypes || variant.buildingType, scheme)
  }

  return scheme[variant.category] || scheme.obstacle
}

function getBuildingTypeOverlayColor(buildingTypes, scheme) {
  const buildingColors = scheme.building
  const types = Array.isArray(buildingTypes) ? buildingTypes : [buildingTypes]

  for (const type of types) {
    if (buildingColors[type]) {
      return buildingColors[type]
    }
  }

  return buildingColors.default
}

function drawCrosswalkTileTypeOverlay(graphics, city, x, y, alpha, scheme) {
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

  fillRect(graphics, px, py, tileSize, tileSize, scheme.crosswalk, alpha)

  for (let stripe = 0; stripe < stripeCount; stripe += 1) {
    fillRect(
      graphics,
      stripeLeft + stripe * (stripeWidth + stripeGap),
      stripeTop,
      stripeWidth,
      stripeHeight,
      scheme.crosswalkStripe,
      alpha
    )
  }
}

function drawChunkedOverlay(city, layer, drawTile) {
  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const graphicsByZorder = new Map()

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          const zorder = city.tileZOrders[city.index(x, y)]
          const graphics = ensureOverlayGraphics(layer, graphicsByZorder, zorder)

          drawTile(graphics, x, y)
        }
      }
    }
  }
}

function ensureOverlayGraphics(layer, graphicsByZorder, zorder) {
  if (!graphicsByZorder.has(zorder)) {
    const graphics = new PIXI.Graphics()

    graphics.eventMode = 'none'
    graphics.zIndex = zorder
    graphics.zorder = zorder
    graphicsByZorder.set(zorder, graphics)
    layer.addChild(graphics)
  }

  return graphicsByZorder.get(zorder)
}
