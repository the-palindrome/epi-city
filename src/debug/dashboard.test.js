import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INFECTION_CONFIG,
  TILE_TYPE_OVERLAY_COLOR_SCHEMES,
  TILE_TYPE_OVERLAY_COLORS
} from '../core/constants.js'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { installDebugDashboard } from './dashboard.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.visible = true
      this.fills = []
    }

    rect(x, y, width, height) {
      return {
        fill: (style) => {
          this.fills.push({ x, y, width, height, ...style })
        }
      }
    }

    destroy() {
      this.destroyed = true
    }

    clear() {
      this.fills = []
    }
  }
}))

class FakeClassList {
  constructor() {
    this.classes = new Set()
  }

  contains(className) {
    return this.classes.has(className)
  }

  toggle(className, force) {
    const shouldAdd = typeof force === 'boolean' ? force : !this.classes.has(className)

    if (shouldAdd) {
      this.classes.add(className)
    } else {
      this.classes.delete(className)
    }

    return shouldAdd
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.classList = new FakeClassList()
    this.dataset = {}
    this.attributes = {}
    this.eventListeners = {}
    this.isContentEditable = false
    this.style = {}
  }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name]
  }

  getBoundingClientRect() {
    return this.rect || {
      left: 0,
      top: 0,
      width: 336,
      height: 176
    }
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId
  }

  releasePointerCapture(pointerId) {
    this.releasedPointerId = pointerId
  }

  removeEventListener(type, listener) {
    if (this.eventListeners[type] === listener) {
      delete this.eventListeners[type]
    }
  }

  focus() {
    globalThis.document.activeElement = this
  }

  blur() {
    this.blurred = true

    if (globalThis.document.activeElement === this) {
      globalThis.document.activeElement = null
    }
  }

  set innerHTML(value) {
    this.children = []
    this._innerHTML = value
  }

  get innerHTML() {
    return this._innerHTML || ''
  }
}

function createDashboardDocument() {
  const dashboard = new FakeElement('div')
  const overlayDashboard = new FakeElement('div')
  const graphDashboard = new FakeElement('div')
  const eventListeners = {}

  graphDashboard.classList.toggle('hidden', true)

  return {
    dashboard,
    overlayDashboard,
    graphDashboard,
    eventListeners,
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName)
    },
    createElementNS(_namespace, tagName) {
      return new FakeElement(tagName)
    },
    getElementById(id) {
      if (id === 'debug-dashboard') {
        return dashboard
      }

      if (id === 'overlay-dashboard') {
        return overlayDashboard
      }

      if (id === 'graph-dashboard') {
        return graphDashboard
      }

      return null
    },
    addEventListener(type, listener) {
      eventListeners[type] = listener
    },
    removeEventListener(type, listener) {
      if (eventListeners[type] === listener) {
        delete eventListeners[type]
      }
    }
  }
}

function createEntityLayer() {
  return {
    children: [],
    addChild(child) {
      this.children.push(child)
      child.parent = this
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child)
      child.parent = null
    }
  }
}

function createCity() {
  return compileCityMap(validateCityMap({
    width: 2,
    height: 2,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'building-0001', type: 'residential', spans: [[1, 1, 1]] }
      ]
    },
    rows: [
      'ss',
      'sb'
    ],
    textureRows: [
      [0, 0],
      [0, 1]
    ]
  }))
}

function createTileOverlayColorCity() {
  return compileCityMap(validateCityMap({
    width: 3,
    height: 2,
    tileSize: 32,
    textureSet: 'test',
    legend: {
      s: { category: 'sidewalk', walkable: true, drivable: false, parkable: false },
      r: { category: 'road', walkable: false, drivable: true, parkable: false },
      b: { category: 'building', walkable: false, drivable: false, parkable: false },
      c: { category: 'building', walkable: false, drivable: false, parkable: false },
      p: { category: 'park', walkable: true, drivable: false, parkable: false },
      w: { category: 'water', walkable: false, drivable: false, parkable: false }
    },
    buildings: {
      encoding: 'row-spans-v1',
      defaultType: 'residential',
      items: [
        { id: 'home', type: 'residential', spans: [[0, 2, 1]] },
        { id: 'shop', type: 'commercial', spans: [[1, 0, 1]] }
      ]
    },
    rows: [
      'srb',
      'cpw'
    ],
    textureRows: [
      [0, 0, 0],
      [0, 0, 0]
    ]
  }))
}

function findByDataset(root, key) {
  if (root.dataset && Object.prototype.hasOwnProperty.call(root.dataset, key)) {
    return root
  }

  for (const child of root.children || []) {
    const found = findByDataset(child, key)

    if (found) {
      return found
    }
  }

  return null
}

function findAllByDataset(root, key, results = []) {
  if (root.dataset && Object.prototype.hasOwnProperty.call(root.dataset, key)) {
    results.push(root)
  }

  for (const child of root.children || []) {
    findAllByDataset(child, key, results)
  }

  return results
}

function createKeydownEvent(overrides = {}) {
  return {
    key: ' ',
    code: 'Space',
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    preventDefault() {
      this.defaultPrevented = true
    },
    ...overrides
  }
}

function createGraphMouseEvent(overrides = {}) {
  return {
    button: 0,
    pointerId: 1,
    clientX: 168,
    clientY: 88,
    deltaY: 0,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    ...overrides
  }
}

describe('debug dashboard overlays', () => {
  const originalDocument = globalThis.document

  beforeEach(() => {
    globalThis.document = createDashboardDocument()
  })

  afterEach(() => {
    globalThis.document = originalDocument
  })

  it('renders the simulation title and s shortcut', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const title = dashboard.element.children[0]
    const shortcut = title.children[0]

    expect(title.className).toBe('dashboard-title')
    expect(title.textContent).toBe('simulation')
    expect(shortcut.className).toBe('dashboard-shortcut')
    expect(shortcut.textContent).toBe('s')

    dashboard.destroy()
  })

  it('renders the rendering options title and r shortcut', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const title = dashboard.overlayElement.children[0]
    const shortcut = title.children[0]
    const overlayToggle = findByDataset(dashboard.overlayElement, 'overlayToggle')
    const mapTextureToggle = findByDataset(dashboard.overlayElement, 'mapTextureToggle')
    const mapTextureOpacity = findByDataset(dashboard.overlayElement, 'mapTextureOpacity')
    const entityRenderMode = findByDataset(dashboard.overlayElement, 'entityRenderMode')
    const infectionRadiusToggle = findByDataset(dashboard.overlayElement, 'infectionRadiusToggle')
    const infectionEdgesToggle = findByDataset(dashboard.overlayElement, 'infectionEdgesToggle')
    const contactEdgesToggle = findByDataset(dashboard.overlayElement, 'contactEdgesToggle')
    const infectionEdgeDurationSlider = findByDataset(dashboard.overlayElement, 'infectionEdgeDurationSlider')
    const infectionEdgeDuration = findByDataset(dashboard.overlayElement, 'infectionEdgeDuration')
    const contactEdgeDurationSlider = findByDataset(dashboard.overlayElement, 'contactEdgeDurationSlider')
    const contactEdgeDuration = findByDataset(dashboard.overlayElement, 'contactEdgeDuration')
    const pathTrailsToggle = findByDataset(dashboard.overlayElement, 'pathTrailsToggle')
    const pathTrailLength = findByDataset(dashboard.overlayElement, 'pathTrailLength')
    const tileOverlayScheme = findByDataset(dashboard.overlayElement, 'tileOverlayScheme')

    expect(title.className).toBe('dashboard-title')
    expect(title.textContent).toBe('rendering options')
    expect(shortcut.className).toBe('dashboard-shortcut')
    expect(shortcut.textContent).toBe('r')
    expect(findByDataset(dashboard.element, 'overlayToggle')).toBeNull()
    expect(mapTextureToggle.checked).toBe(true)
    expect(mapTextureOpacity.value).toBe('1')
    expect(entityRenderMode.value).toBe('sprite')
    expect(entityRenderMode.children.map((option) => option.value)).toEqual([
      'sprite',
      'geometric'
    ])
    expect(infectionRadiusToggle.checked).toBe(false)
    expect(infectionEdgesToggle.checked).toBe(false)
    expect(contactEdgesToggle.checked).toBe(false)
    expect(infectionEdgeDurationSlider.min).toBe('1')
    expect(infectionEdgeDuration.value).toBe('10')
    expect(contactEdgeDurationSlider.min).toBe('1')
    expect(contactEdgeDuration.value).toBe('10')
    const entityControls = infectionEdgesToggle.parentNode.parentNode.children
    const infectionEdgesIndex = entityControls.indexOf(infectionEdgesToggle.parentNode)
    const infectionEdgeDurationIndex = entityControls.indexOf(infectionEdgeDuration.parentNode.parentNode)
    const contactEdgesIndex = entityControls.indexOf(contactEdgesToggle.parentNode)

    expect(infectionEdgeDurationIndex).toBe(infectionEdgesIndex + 1)
    expect(contactEdgesIndex).toBe(infectionEdgeDurationIndex + 1)
    expect(pathTrailsToggle.checked).toBe(false)
    expect(pathTrailLength.value).toBe('5')
    expect(overlayToggle).not.toBeNull()
    expect(overlayToggle.dataset.overlayToggle).toBe('tileType')
    expect(overlayToggle.parentNode.children[1].textContent).toBe('tile overlay')
    expect(tileOverlayScheme.value).toBe('tileType')
    expect(tileOverlayScheme.children.map((option) => option.value)).toEqual([
      'tileType',
      'monochrome-light',
      'monochrome-dark'
    ])
    expect(findByDataset(dashboard.overlayElement, 'tileTypeOverlayOpacity')).not.toBeNull()

    dashboard.destroy()
  })

  it('renders the epidemic graph title, g shortcut, toggles, and plot', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const title = dashboard.graphElement.children[0]
    const shortcut = title.children[0]
    const toggles = findAllByDataset(dashboard.graphElement, 'epidemicGraphToggle')
    const plot = findByDataset(dashboard.graphElement, 'epidemicGraphPlot')
    const grid = findByDataset(dashboard.graphElement, 'epidemicGraphGrid')
    const ticks = findByDataset(dashboard.graphElement, 'epidemicGraphTicks')
    const xAxisLabel = findByDataset(dashboard.graphElement, 'epidemicGraphXAxisLabel')
    const yAxisLabel = findByDataset(dashboard.graphElement, 'epidemicGraphYAxisLabel')
    const resizeHandle = findByDataset(dashboard.graphElement, 'graphResizeHandle')

    expect(title.className).toBe('dashboard-title')
    expect(title.textContent).toBe('epidemic')
    expect(shortcut.className).toBe('dashboard-shortcut')
    expect(shortcut.textContent).toBe('g')
    expect(toggles.map((toggle) => [toggle.dataset.epidemicGraphToggle, toggle.checked])).toEqual([
      ['susceptible', true],
      ['exposed', true],
      ['infectious', true],
      ['recovered', true]
    ])
    expect(plot.getAttribute('class')).toBe('epidemic-graph-plot')
    expect(plot.getAttribute('viewBox')).toBe('0 0 336 176')
    expect(grid).not.toBeNull()
    expect(ticks).not.toBeNull()
    expect(xAxisLabel.textContent).toBe('time (h)')
    expect(yAxisLabel.textContent).toBe('cases')
    expect(resizeHandle.className).toBe('graph-dashboard-resize-handle')

    plot.rect = { left: 0, top: 0, width: 514, height: 367.16 }
    dashboard.graph.render()

    expect(plot.getAttribute('viewBox')).toBe('0 0 514 367.16')
    expect(xAxisLabel.getAttribute('font-size')).toBe('12')

    dashboard.destroy()
  })

  it('toggles the dashboard with the s hotkey', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown

    const hideEvent = createKeydownEvent({ key: 's', code: 'KeyS' })
    keydown(hideEvent)

    expect(hideEvent.defaultPrevented).toBe(true)
    expect(dashboard.element.classList.contains('hidden')).toBe(true)

    const showEvent = createKeydownEvent({ key: 'S', code: 'KeyS' })
    keydown(showEvent)

    expect(showEvent.defaultPrevented).toBe(true)
    expect(dashboard.element.classList.contains('hidden')).toBe(false)

    dashboard.destroy()
  })

  it('toggles the rendering options dashboard with the r hotkey', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown

    const hideEvent = createKeydownEvent({ key: 'r', code: 'KeyR' })
    keydown(hideEvent)

    expect(hideEvent.defaultPrevented).toBe(true)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(true)
    expect(dashboard.element.classList.contains('hidden')).toBe(false)

    const showEvent = createKeydownEvent({ key: 'R', code: 'KeyR' })
    keydown(showEvent)

    expect(showEvent.defaultPrevented).toBe(true)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(false)

    dashboard.destroy()
  })

  it('toggles the epidemic graph with the g hotkey', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown

    expect(dashboard.graphElement.classList.contains('hidden')).toBe(true)

    const showEvent = createKeydownEvent({ key: 'g', code: 'KeyG' })
    keydown(showEvent)

    expect(showEvent.defaultPrevented).toBe(true)
    expect(dashboard.graphElement.classList.contains('hidden')).toBe(false)

    const hideEvent = createKeydownEvent({ key: 'G', code: 'KeyG' })
    keydown(hideEvent)

    expect(hideEvent.defaultPrevented).toBe(true)
    expect(dashboard.graphElement.classList.contains('hidden')).toBe(true)

    dashboard.destroy()
  })

  it('does not toggle the dashboard with the s hotkey inside editable controls', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown
    const seedInput = findByDataset(dashboard.element, 'simulationSeed')

    const inputEvent = createKeydownEvent({ key: 's', code: 'KeyS', target: seedInput })
    keydown(inputEvent)

    expect(inputEvent.defaultPrevented).toBe(false)
    expect(dashboard.element.classList.contains('hidden')).toBe(false)

    dashboard.destroy()
  })

  it('does not toggle the rendering options dashboard with the r hotkey inside editable controls', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown
    const seedInput = findByDataset(dashboard.element, 'simulationSeed')

    const inputEvent = createKeydownEvent({ key: 'r', code: 'KeyR', target: seedInput })
    keydown(inputEvent)

    expect(inputEvent.defaultPrevented).toBe(false)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(false)

    dashboard.destroy()
  })

  it('keeps dashboard hotkeys available from non-text dashboard controls', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown
    const entityRenderMode = findByDataset(dashboard.overlayElement, 'entityRenderMode')
    const playButton = findByDataset(dashboard.element, 'simulationAction')

    const renderEvent = createKeydownEvent({ key: 'r', code: 'KeyR', target: entityRenderMode })
    keydown(renderEvent)

    expect(renderEvent.defaultPrevented).toBe(true)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(true)

    const simulationEvent = createKeydownEvent({ key: 's', code: 'KeyS', target: playButton })
    keydown(simulationEvent)

    expect(simulationEvent.defaultPrevented).toBe(true)
    expect(dashboard.element.classList.contains('hidden')).toBe(true)

    dashboard.destroy()
  })

  it('renders tile overlay chunks at the z-order of their covered tiles', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createCity(), entityLayer)

    dashboard.setOverlay('tileType', true)

    const overlayZorders = entityLayer.children.map((child) => child.zorder).sort((a, b) => a - b)

    expect(overlayZorders).toEqual([0, 2])
    expect(entityLayer.sortableChildren).toBe(true)
    expect(entityLayer.children.every((child) => child.zIndex === child.zorder)).toBe(true)

    dashboard.setOverlay('tileType', false)

    expect(entityLayer.children.map((child) => child.visible)).toEqual([false, false])

    dashboard.destroy()
  })

  it('colors tile overlays by category, building type, and opacity', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createTileOverlayColorCity(), entityLayer)
    const scheme = TILE_TYPE_OVERLAY_COLOR_SCHEMES.tileType

    dashboard.setOverlay('tileType', true)

    const fills = entityLayer.children.flatMap((child) => child.fills)
    const fillAt = (x, y) => fills.find((fill) => fill.x === x * 32 && fill.y === y * 32)

    expect(fillAt(0, 0)).toMatchObject({
      color: scheme.sidewalk,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(1, 0)).toMatchObject({
      color: scheme.road,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(2, 0)).toMatchObject({
      color: scheme.building.residential,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(0, 1)).toMatchObject({
      color: scheme.building.commercial,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })

    dashboard.destroy()
  })

  it('updates tile overlay color scheme from the rendering options dropdown', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createTileOverlayColorCity(), entityLayer)
    const schemeSelect = findByDataset(dashboard.overlayElement, 'tileOverlayScheme')

    dashboard.setOverlay('tileType', true)
    schemeSelect.value = 'monochrome-dark'
    schemeSelect.eventListeners.change()

    const darkFills = entityLayer.children.flatMap((child) => child.fills)
    const darkFillAt = (x, y) => darkFills.find((fill) => fill.x === x * 32 && fill.y === y * 32)

    expect(dashboard.rendering.tileOverlayScheme).toBe('monochrome-dark')
    expect(darkFillAt(1, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLOR_SCHEMES['monochrome-dark'].road,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(darkFillAt(2, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLOR_SCHEMES['monochrome-dark'].building.residential,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })

    dashboard.setTileOverlayScheme('monochrome-light')

    const lightFills = entityLayer.children.flatMap((child) => child.fills)
    const lightFillAt = (x, y) => lightFills.find((fill) => fill.x === x * 32 && fill.y === y * 32)

    expect(schemeSelect.value).toBe('monochrome-light')
    expect(lightFillAt(0, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLOR_SCHEMES['monochrome-light'].sidewalk,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })

    dashboard.destroy()
  })

  it('updates the tile overlay opacity from the rendering options slider', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createTileOverlayColorCity(), entityLayer)
    const opacity = findByDataset(dashboard.overlayElement, 'tileTypeOverlayOpacity')
    const opacityValue = findByDataset(dashboard.overlayElement, 'tileTypeOverlayOpacityValue')

    dashboard.setOverlay('tileType', true)
    opacity.value = '0.35'
    opacity.eventListeners.input()

    const fills = entityLayer.children.flatMap((child) => child.fills)

    expect(opacityValue.textContent).toBe('35%')
    expect(fills.every((fill) => fill.alpha === 0.35)).toBe(true)

    dashboard.destroy()
  })

  it('updates map texture visibility and opacity from rendering options controls', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      onMapTextureEnabledChange(enabled) {
        changes.push(['enabled', enabled])
      },
      onMapTextureOpacityChange(opacity) {
        changes.push(['opacity', opacity])
      }
    })
    const mapTextureToggle = findByDataset(dashboard.overlayElement, 'mapTextureToggle')
    const mapTextureOpacity = findByDataset(dashboard.overlayElement, 'mapTextureOpacity')
    const mapTextureOpacityValue = findByDataset(dashboard.overlayElement, 'mapTextureOpacityValue')

    expect(mapTextureToggle.checked).toBe(true)
    expect(mapTextureOpacity.value).toBe('1')
    expect(mapTextureOpacityValue.textContent).toBe('100%')

    mapTextureToggle.checked = false
    mapTextureToggle.eventListeners.change()
    mapTextureOpacity.value = '0.4'
    mapTextureOpacity.eventListeners.input()

    expect(dashboard.rendering.mapTextureEnabled).toBe(false)
    expect(dashboard.rendering.mapTextureOpacity).toBe(0.4)
    expect(mapTextureOpacityValue.textContent).toBe('40%')
    expect(changes).toEqual([
      ['enabled', false],
      ['opacity', 0.4]
    ])

    dashboard.setMapTextureEnabled(true)
    dashboard.setMapTextureOpacity(2)

    expect(mapTextureToggle.checked).toBe(true)
    expect(mapTextureOpacity.value).toBe('1')
    expect(mapTextureOpacityValue.textContent).toBe('100%')
    expect(changes).toEqual([
      ['enabled', false],
      ['opacity', 0.4],
      ['enabled', true],
      ['opacity', 1]
    ])

    dashboard.destroy()
  })

  it('updates entity rendering mode from rendering options controls', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      onEntityRenderModeChange(mode) {
        changes.push(['mode', mode])
      },
      onInfectionRadiusVisibleChange(visible) {
        changes.push(['radius', visible])
      },
      onInfectionEdgesVisibleChange(visible) {
        changes.push(['edges', visible])
      },
      onContactEdgesVisibleChange(visible) {
        changes.push(['contacts', visible])
      },
      onInfectionEdgeDurationChange(duration) {
        changes.push(['infectionDuration', duration])
      },
      onContactEdgeDurationChange(duration) {
        changes.push(['contactDuration', duration])
      },
      onPathTrailsVisibleChange(visible) {
        changes.push(['trails', visible])
      },
      onPathTrailLengthChange(length) {
        changes.push(['trailLength', length])
      }
    })
    const entityRenderMode = findByDataset(dashboard.overlayElement, 'entityRenderMode')
    const infectionRadiusToggle = findByDataset(dashboard.overlayElement, 'infectionRadiusToggle')
    const infectionEdgesToggle = findByDataset(dashboard.overlayElement, 'infectionEdgesToggle')
    const contactEdgesToggle = findByDataset(dashboard.overlayElement, 'contactEdgesToggle')
    const infectionEdgeDurationSlider = findByDataset(dashboard.overlayElement, 'infectionEdgeDurationSlider')
    const infectionEdgeDuration = findByDataset(dashboard.overlayElement, 'infectionEdgeDuration')
    const contactEdgeDurationSlider = findByDataset(dashboard.overlayElement, 'contactEdgeDurationSlider')
    const contactEdgeDuration = findByDataset(dashboard.overlayElement, 'contactEdgeDuration')
    const pathTrailsToggle = findByDataset(dashboard.overlayElement, 'pathTrailsToggle')
    const pathTrailLengthSlider = findByDataset(dashboard.overlayElement, 'pathTrailLengthSlider')
    const pathTrailLength = findByDataset(dashboard.overlayElement, 'pathTrailLength')

    entityRenderMode.value = 'geometric'
    entityRenderMode.eventListeners.change()
    infectionRadiusToggle.checked = true
    infectionRadiusToggle.eventListeners.change()
    infectionEdgesToggle.checked = true
    infectionEdgesToggle.eventListeners.change()
    contactEdgesToggle.checked = true
    contactEdgesToggle.eventListeners.change()
    infectionEdgeDurationSlider.value = '30'
    infectionEdgeDurationSlider.eventListeners.input()
    contactEdgeDurationSlider.value = '120'
    contactEdgeDurationSlider.eventListeners.input()
    pathTrailsToggle.checked = true
    pathTrailsToggle.eventListeners.change()
    pathTrailLength.value = '120'
    pathTrailLength.eventListeners.change()

    expect(dashboard.rendering.entityRenderMode).toBe('geometric')
    expect(dashboard.rendering.infectionRadiusVisible).toBe(true)
    expect(dashboard.rendering.infectionEdgesVisible).toBe(true)
    expect(dashboard.rendering.contactEdgesVisible).toBe(true)
    expect(dashboard.rendering.infectionEdgeDurationMinutes).toBe(30)
    expect(dashboard.rendering.contactEdgeDurationMinutes).toBe(120)
    expect(infectionEdgeDuration.value).toBe('30')
    expect(contactEdgeDuration.value).toBe('120')
    expect(dashboard.rendering.pathTrailsVisible).toBe(true)
    expect(dashboard.rendering.pathTrailLength).toBe(100)
    expect(pathTrailLengthSlider.value).toBe('100')
    expect(changes).toEqual([
      ['mode', 'geometric'],
      ['radius', true],
      ['edges', true],
      ['contacts', true],
      ['infectionDuration', 30],
      ['contactDuration', 120],
      ['trails', true],
      ['trailLength', 100]
    ])

    dashboard.setEntityRenderMode('sprite')
    dashboard.setInfectionEdgeDuration(1)
    dashboard.setContactEdgeDuration(1)
    dashboard.setPathTrailLength(1)
    dashboard.setInfectionRadiusVisible(false)
    dashboard.setInfectionEdgesVisible(false)
    dashboard.setContactEdgesVisible(false)
    dashboard.setPathTrailsVisible(false)

    expect(entityRenderMode.value).toBe('sprite')
    expect(infectionEdgeDuration.value).toBe('1')
    expect(contactEdgeDuration.value).toBe('1')
    expect(pathTrailLength.value).toBe('1')

    dashboard.setEntityRenderMode('unknown')

    expect(dashboard.rendering.entityRenderMode).toBe('sprite')
    expect(changes).toEqual([
      ['mode', 'geometric'],
      ['radius', true],
      ['edges', true],
      ['contacts', true],
      ['infectionDuration', 30],
      ['contactDuration', 120],
      ['trails', true],
      ['trailLength', 100],
      ['mode', 'sprite'],
      ['infectionDuration', 1],
      ['contactDuration', 1],
      ['trailLength', 1],
      ['radius', false],
      ['edges', false],
      ['contacts', false],
      ['trails', false],
      ['mode', 'sprite']
    ])

    dashboard.destroy()
  })

  it('updates NPC count from the slider and exact number input', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      npcCount: 1000,
      npcCountRange: { min: 100, max: 10000, step: 100 },
      onNpcCountChange(count) {
        changes.push(count)
      }
    })
    const slider = findByDataset(dashboard.element, 'simulationNpcCountSlider')
    const input = findByDataset(dashboard.element, 'simulationNpcCount')

    expect(slider.min).toBe('100')
    expect(slider.max).toBe('10000')
    expect(slider.value).toBe('1000')
    expect(input.value).toBe('1000')

    slider.value = '2500'
    slider.eventListeners.input()

    expect(dashboard.simulation.state.npcCount).toBe(2500)
    expect(input.value).toBe('2500')

    slider.eventListeners.change()

    expect(changes).toEqual([2500])

    input.value = '1234'
    input.eventListeners.change()

    expect(dashboard.simulation.state.npcCount).toBe(1234)
    expect(slider.value).toBe('1234')
    expect(changes).toEqual([2500, 1234])

    input.value = '42'
    input.eventListeners.change()

    expect(dashboard.simulation.state.npcCount).toBe(100)
    expect(changes).toEqual([2500, 1234, 100])

    dashboard.destroy()
  })

  it('updates car count from the slider and exact number input', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      carCount: 100,
      carCountRange: { min: 0, max: 2000, step: 10 },
      onCarCountChange(count) {
        changes.push(count)
      }
    })
    const slider = findByDataset(dashboard.element, 'simulationCarCountSlider')
    const input = findByDataset(dashboard.element, 'simulationCarCount')

    expect(slider.min).toBe('0')
    expect(slider.max).toBe('2000')
    expect(slider.value).toBe('100')
    expect(input.value).toBe('100')

    slider.value = '250'
    slider.eventListeners.input()

    expect(dashboard.simulation.state.carCount).toBe(250)
    expect(input.value).toBe('250')

    slider.eventListeners.change()

    expect(changes).toEqual([250])

    input.value = '999'
    input.eventListeners.change()

    expect(dashboard.simulation.state.carCount).toBe(999)
    expect(slider.value).toBe('999')
    expect(changes).toEqual([250, 999])

    input.value = '5000'
    input.eventListeners.change()

    expect(dashboard.simulation.state.carCount).toBe(2000)
    expect(changes).toEqual([250, 999, 2000])

    dashboard.destroy()
  })

  it('updates simulation speed and allows 24x playback', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      speed: 1,
      speedRange: { min: 1, max: 24, step: 0.25 },
      onSpeedChange(speed) {
        changes.push(speed)
      }
    })
    const speed = findByDataset(dashboard.element, 'simulationSpeed')

    expect(speed.min).toBe('1')
    expect(speed.max).toBe('24')
    expect(speed.step).toBe('0.25')
    expect(speed.value).toBe('1')

    speed.value = '24'
    speed.eventListeners.input()

    expect(dashboard.simulation.state.speed).toBe(24)
    expect(changes).toEqual([24])

    dashboard.simulation.setSpeed(99)

    expect(dashboard.simulation.state.speed).toBe(24)
    expect(speed.value).toBe('24')

    dashboard.destroy()
  })

  it('updates infection controls and renders SEIR counts', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      infectionDistance: 48,
      initialInfectiousCount: 4,
      initialInfectiousCountRange: { min: 0, max: 10000, step: 1 },
      infectionDistanceRange: { min: 0, max: 256, step: 1 },
      infectionProbability: 0.03,
      infectionProbabilityRange: { min: 0, max: 1, step: 0.01 },
      incubationDaysRange: { min: 0, max: 14, step: 0.25 },
      infectionDays: 7,
      infectionDaysRange: { min: 0, max: 21, step: 0.25 },
      immunityDays: 90,
      immunityDaysRange: { min: 0, max: 365, step: 1 },
      getInfectionStats() {
        return { susceptible: 8, exposed: 1, infectious: 2, recovered: 3 }
      },
      onInfectionDistanceChange(value) {
        changes.push(['distance', value])
      },
      onInitialInfectiousCountChange(value) {
        changes.push(['initial', value])
      },
      onInfectionProbabilityChange(value) {
        changes.push(['probability', value])
      },
      onIncubationDaysChange(value) {
        changes.push(['incubation', value])
      },
      onInfectionDaysChange(value) {
        changes.push(['infection', value])
      },
      onImmunityDaysChange(value) {
        changes.push(['immunity', value])
      }
    })
    const stats = findByDataset(dashboard.element, 'simulationInfectionStats')
    const initialInfectiousCount = findByDataset(dashboard.element, 'simulationInitialInfectiousCount')
    const distance = findByDataset(dashboard.element, 'simulationInfectionDistance')
    const probability = findByDataset(dashboard.element, 'simulationInfectionProbability')
    const incubationDays = findByDataset(dashboard.element, 'simulationIncubationDays')
    const infectionDays = findByDataset(dashboard.element, 'simulationInfectionDays')
    const immunityDays = findByDataset(dashboard.element, 'simulationImmunityDays')

    expect(stats.textContent).toBe('S 8 E 1 I 2 R 3')
    expect(initialInfectiousCount.value).toBe('4')
    expect(distance.value).toBe('48')
    expect(probability.value).toBe('0.03')
    expect(incubationDays.value).toBe('1')
    expect(infectionDays.value).toBe('7')
    expect(immunityDays.value).toBe('90')

    initialInfectiousCount.value = '13'
    initialInfectiousCount.eventListeners.change()
    distance.value = '64'
    distance.eventListeners.change()
    probability.value = '2'
    probability.eventListeners.change()
    incubationDays.value = '20'
    incubationDays.eventListeners.change()
    infectionDays.value = '3.5'
    infectionDays.eventListeners.change()
    immunityDays.value = '-1'
    immunityDays.eventListeners.change()

    expect(dashboard.simulation.state.initialInfectiousCount).toBe(13)
    expect(dashboard.simulation.state.infectionDistance).toBe(64)
    expect(dashboard.simulation.state.infectionProbability).toBe(1)
    expect(dashboard.simulation.state.incubationDays).toBe(14)
    expect(dashboard.simulation.state.infectionDays).toBe(3.5)
    expect(dashboard.simulation.state.immunityDays).toBe(0)
    expect(changes).toEqual([
      ['initial', 13],
      ['distance', 64],
      ['probability', 1],
      ['incubation', 14],
      ['infection', 3.5],
      ['immunity', 0]
    ])

    dashboard.simulation.setImmunityDays(30)
    dashboard.simulation.setInitialInfectiousCount(5)

    expect(immunityDays.value).toBe('30')
    expect(initialInfectiousCount.value).toBe('5')

    dashboard.destroy()
  })

  it('samples infection stats and plots selected epidemic graph states over time', () => {
    const clock = {
      seconds: 0,
      getElapsedSimulationSeconds() {
        return this.seconds
      }
    }
    let stats = { susceptible: 8, exposed: 1, infectious: 2, recovered: 0 }
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      clock,
      getInfectionStats() {
        return stats
      }
    })

    dashboard.render()
    clock.seconds = 3600
    stats = { susceptible: 6, exposed: 2, infectious: 3, recovered: 0 }
    dashboard.render()

    const lines = findAllByDataset(dashboard.graphElement, 'epidemicGraphLine')
    const susceptibleLine = lines.find((line) => line.dataset.epidemicGraphLine === 'susceptible')
    const exposedLine = lines.find((line) => line.dataset.epidemicGraphLine === 'exposed')
    const exposedToggle = findAllByDataset(dashboard.graphElement, 'epidemicGraphToggle')
      .find((toggle) => toggle.dataset.epidemicGraphToggle === 'exposed')

    expect(dashboard.graph.samples).toEqual([
      expect.objectContaining({ timeSeconds: 0, susceptible: 8, exposed: 1, infectious: 2, recovered: 0 }),
      expect.objectContaining({ timeSeconds: 3600, susceptible: 6, exposed: 2, infectious: 3, recovered: 0 })
    ])
    expect(susceptibleLine.getAttribute('points').split(' ')).toHaveLength(2)
    expect(exposedLine.getAttribute('points')).not.toBe('')

    exposedToggle.checked = false
    exposedToggle.eventListeners.change()

    expect(dashboard.graph.visibleStates.exposed).toBe(false)
    expect(exposedLine.getAttribute('points')).toBe('')

    dashboard.destroy()
  })

  it('keeps epidemic graph samples for the full simulation history', () => {
    const clock = {
      seconds: 0,
      getElapsedSimulationSeconds() {
        return this.seconds
      }
    }
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      clock,
      getInfectionStats() {
        return { susceptible: 8, exposed: 1, infectious: 2, recovered: 0 }
      }
    })

    for (let sampleIndex = 0; sampleIndex < 730; sampleIndex += 1) {
      clock.seconds = sampleIndex * 5 * 60
      dashboard.render()
    }

    expect(dashboard.graph.samples).toHaveLength(730)
    expect(dashboard.graph.samples[0]).toEqual(expect.objectContaining({ timeSeconds: 0 }))
    expect(dashboard.graph.samples[729]).toEqual(expect.objectContaining({ timeSeconds: 729 * 5 * 60 }))

    dashboard.destroy()
  })

  it('zooms and pans only the epidemic graph time axis with plot mouse interactions', () => {
    const clock = {
      seconds: 0,
      getElapsedSimulationSeconds() {
        return this.seconds
      }
    }
    let stats = { susceptible: 8, exposed: 1, infectious: 2, recovered: 0 }
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      clock,
      getInfectionStats() {
        return stats
      }
    })

    dashboard.render()
    clock.seconds = 3600
    stats = { susceptible: 6, exposed: 2, infectious: 3, recovered: 1 }
    dashboard.render()

    const line = findAllByDataset(dashboard.graphElement, 'epidemicGraphLine')
      .find((item) => item.dataset.epidemicGraphLine === 'susceptible')
    const initialPoints = line.getAttribute('points')
    const wheelEvent = createGraphMouseEvent({ deltaY: -240, clientX: 168, clientY: 88 })

    dashboard.graph.plot.eventListeners.wheel(wheelEvent)

    const zoomedPoints = line.getAttribute('points')

    expect(wheelEvent.defaultPrevented).toBe(true)
    expect(zoomedPoints).not.toBe(initialPoints)
    expect(dashboard.graph.view.timeStartSeconds).toBeGreaterThanOrEqual(0)
    expect(dashboard.graph.view.timeEndSeconds).toBeLessThan(3600)
    expect(dashboard.graph.view).not.toHaveProperty('valueMin')
    expect(dashboard.graph.view).not.toHaveProperty('valueMax')

    const verticalPointerDown = createGraphMouseEvent({ clientX: 168, clientY: 88 })
    dashboard.graph.plot.eventListeners.pointerdown(verticalPointerDown)
    globalThis.document.eventListeners.pointermove(createGraphMouseEvent({ clientX: 168, clientY: 130 }))
    globalThis.document.eventListeners.pointerup(createGraphMouseEvent({ clientX: 168, clientY: 130 }))

    expect(verticalPointerDown.defaultPrevented).toBe(true)
    expect(line.getAttribute('points')).toBe(zoomedPoints)

    const horizontalPointerDown = createGraphMouseEvent({ clientX: 168, clientY: 88 })
    dashboard.graph.plot.eventListeners.pointerdown(horizontalPointerDown)
    globalThis.document.eventListeners.pointermove(createGraphMouseEvent({ clientX: 220, clientY: 88 }))
    globalThis.document.eventListeners.pointerup(createGraphMouseEvent({ clientX: 220, clientY: 88 }))

    expect(horizontalPointerDown.defaultPrevented).toBe(true)
    expect(line.getAttribute('points')).not.toBe(zoomedPoints)
    expect(dashboard.graph.plot.capturedPointerId).toBe(1)
    expect(dashboard.graph.plot.releasedPointerId).toBe(1)

    dashboard.destroy()
  })

  it('resizes the epidemic graph from the upper-right handle', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const resizeHandle = findByDataset(dashboard.graphElement, 'graphResizeHandle')
    const pointerDown = createGraphMouseEvent({ clientX: 300, clientY: 60 })

    dashboard.graphElement.rect = {
      left: 16,
      top: 320,
      width: 380,
      height: 260
    }
    resizeHandle.eventListeners.pointerdown(pointerDown)
    resizeHandle.eventListeners.pointermove(createGraphMouseEvent({ clientX: 460, clientY: 10 }))
    resizeHandle.eventListeners.pointerup(createGraphMouseEvent({ clientX: 460, clientY: 10 }))

    expect(pointerDown.defaultPrevented).toBe(true)
    expect(dashboard.graphElement.style.width).toBe('540px')
    expect(dashboard.graphElement.style.height).toBe('310px')
    expect(resizeHandle.capturedPointerId).toBe(1)
    expect(resizeHandle.releasedPointerId).toBe(1)

    dashboard.destroy()
  })

  it('shows the simulation clock and toggles the day-night overlay control', () => {
    const changes = []
    const clock = {
      dayIndex: 0,
      time: '08:00',
      formatTimeOfDay() {
        return this.time
      },
      getDayIndex() {
        return this.dayIndex
      }
    }
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      clock,
      dayNightOverlayEnabled: true,
      onDayNightOverlayChange(enabled) {
        changes.push(enabled)
      }
    })
    const clockDisplay = findByDataset(dashboard.element, 'simulationClock')
    const dayNightToggle = findByDataset(dashboard.element, 'simulationDayNightToggle')

    expect(clockDisplay.textContent).toBe('day 1 08:00')
    expect(dayNightToggle.checked).toBe(true)

    clock.dayIndex = 2
    clock.time = '23:45'
    dashboard.render()

    expect(clockDisplay.textContent).toBe('day 3 23:45')

    dayNightToggle.checked = false
    dayNightToggle.eventListeners.change()

    expect(dashboard.simulation.state.dayNightOverlayEnabled).toBe(false)
    expect(changes).toEqual([false])

    dashboard.simulation.setDayNightOverlayEnabled(true)

    expect(dayNightToggle.checked).toBe(true)

    dashboard.destroy()
  })

  it('toggles simulation playback with the Space hotkey', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      paused: false,
      onPlay() {
        changes.push('play')
      },
      onPause() {
        changes.push('pause')
      }
    })
    const keydown = globalThis.document.eventListeners.keydown

    const pauseEvent = createKeydownEvent()
    keydown(pauseEvent)

    expect(pauseEvent.defaultPrevented).toBe(true)
    expect(dashboard.simulation.state.paused).toBe(true)
    expect(changes).toEqual(['pause'])

    const playEvent = createKeydownEvent()
    keydown(playEvent)

    expect(playEvent.defaultPrevented).toBe(true)
    expect(dashboard.simulation.state.paused).toBe(false)
    expect(changes).toEqual(['pause', 'play'])

    dashboard.destroy()
    expect(globalThis.document.eventListeners.keydown).toBeUndefined()
  })

  it('does not use Space as a playback hotkey inside dashboard controls', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      onPlay() {
        changes.push('play')
      },
      onPause() {
        changes.push('pause')
      }
    })
    const keydown = globalThis.document.eventListeners.keydown
    const seedInput = findByDataset(dashboard.element, 'simulationSeed')
    const playButton = findByDataset(dashboard.element, 'simulationAction')

    const inputEvent = createKeydownEvent({ target: seedInput })
    keydown(inputEvent)

    expect(inputEvent.defaultPrevented).toBe(false)

    const buttonEvent = createKeydownEvent({ target: playButton })
    keydown(buttonEvent)

    expect(buttonEvent.defaultPrevented).toBe(false)
    expect(dashboard.simulation.state.paused).toBe(false)
    expect(changes).toEqual([])

    dashboard.destroy()
  })

  it('releases non-text dashboard control focus after mouse interactions so Space works again', () => {
    const changes = []
    const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
      paused: false,
      onPlay() {
        changes.push('play')
      },
      onPause() {
        changes.push('pause')
      }
    })
    const keydown = globalThis.document.eventListeners.keydown
    const mapTextureToggle = findByDataset(dashboard.overlayElement, 'mapTextureToggle')
    const entityRenderMode = findByDataset(dashboard.overlayElement, 'entityRenderMode')

    mapTextureToggle.focus()
    dashboard.overlayElement.eventListeners.click({
      type: 'click',
      target: mapTextureToggle,
      currentTarget: dashboard.overlayElement
    })

    expect(mapTextureToggle.blurred).toBe(true)
    expect(globalThis.document.activeElement).toBeNull()

    entityRenderMode.focus()
    dashboard.overlayElement.eventListeners.change({
      type: 'change',
      target: entityRenderMode,
      currentTarget: dashboard.overlayElement
    })

    expect(entityRenderMode.blurred).toBe(true)
    expect(globalThis.document.activeElement).toBeNull()

    const pauseEvent = createKeydownEvent()
    keydown(pauseEvent)

    expect(pauseEvent.defaultPrevented).toBe(true)
    expect(dashboard.simulation.state.paused).toBe(true)
    expect(changes).toEqual(['pause'])

    dashboard.destroy()
  })

  describe('SEIR kernel-density heatmap overlays', () => {
    it('renders S/E/I/R heatmap toggles in rendering options with the tile overlay controls', () => {
      const dashboard = installDebugDashboard(createCity(), createEntityLayer())
      const toggles = findAllByDataset(dashboard.overlayElement, 'overlayToggle')
      const labelsById = Object.fromEntries(
        toggles.map((toggle) => [toggle.dataset.overlayToggle, toggle.parentNode.children[1].textContent])
      )

      expect(labelsById).toMatchObject({
        tileType: 'tile overlay',
        heatmapSusceptible: 'S heatmap',
        heatmapExposed: 'E heatmap',
        heatmapInfectious: 'I heatmap',
        heatmapRecovered: 'R heatmap'
      })

      dashboard.destroy()
    })

    it('exposes a heatmap radius control with clamped state, value text, and change callback', () => {
      const changes = []
      const dashboard = installDebugDashboard(createCity(), createEntityLayer(), {
        heatmapRadius: 64,
        heatmapRadiusRange: { min: 16, max: 128, step: 16 },
        onHeatmapRadiusChange(radius) {
          changes.push(radius)
        }
      })
      const slider = findByDataset(dashboard.overlayElement, 'heatmapRadiusSlider')
      const input = findByDataset(dashboard.overlayElement, 'heatmapRadius')

      expect(slider.min).toBe('16')
      expect(slider.max).toBe('128')
      expect(slider.step).toBe('16')
      expect(slider.value).toBe('64')
      expect(input.value).toBe('64')

      slider.value = '80'
      slider.eventListeners.input()

      expect(dashboard.rendering.heatmapRadius).toBe(80)
      expect(input.value).toBe('80')

      input.value = '512'
      input.eventListeners.change()

      expect(dashboard.rendering.heatmapRadius).toBe(128)
      expect(slider.value).toBe('128')

      dashboard.setHeatmapRadius(0)

      expect(dashboard.rendering.heatmapRadius).toBe(16)
      expect(changes).toEqual([80, 128, 16])

      dashboard.destroy()
    })

    it('builds one heatmap layer per enabled SEIR state from current NPC positions and infection states', () => {
      const entityLayer = createEntityLayer()
      let getNpcsCalls = 0
      const dashboard = installDebugDashboard(createCity(), entityLayer, {
        heatmapRadius: 16,
        getNpcs() {
          getNpcsCalls += 1
          return [
            { infection: 'susceptible', position: { x: 16, y: 16 } },
            { infection: 'infectious', position: { x: 48, y: 48 } },
            { infection: 'recovered', position: { x: 16, y: 48 }, vehicleTrip: true }
          ]
        }
      })

      dashboard.render()

      expect(getNpcsCalls).toBe(0)

      dashboard.setOverlay('heatmapSusceptible', true)
      dashboard.setOverlay('heatmapInfectious', true)

      const fills = entityLayer.children.flatMap((child) => child.fills)

      expect(entityLayer.children).toHaveLength(2)
      expect(fills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            x: 0,
            y: 0,
            color: INFECTION_CONFIG.colors.susceptible,
            alpha: 0.72
          }),
          expect.objectContaining({
            x: 32,
            y: 32,
            color: INFECTION_CONFIG.colors.infectious,
            alpha: 0.72
          })
        ])
      )
      expect(fills.some((fill) => fill.color === INFECTION_CONFIG.colors.recovered)).toBe(false)

      dashboard.destroy()
    })

    it('redraws enabled heatmaps on render so moved NPCs and infection transitions update without toggling', () => {
      const entityLayer = createEntityLayer()
      const npc = { infection: 'susceptible', position: { x: 16, y: 16 } }
      const dashboard = installDebugDashboard(createCity(), entityLayer, {
        heatmapRadius: 16,
        getNpcs: () => [npc]
      })

      dashboard.setOverlay('heatmapSusceptible', true)

      const heatmap = entityLayer.children[0]

      expect(heatmap.fills).toEqual([
        expect.objectContaining({ x: 0, y: 0, color: INFECTION_CONFIG.colors.susceptible })
      ])

      npc.position = { x: 48, y: 48 }
      dashboard.render()

      expect(heatmap.fills).toEqual([
        expect.objectContaining({ x: 32, y: 32, color: INFECTION_CONFIG.colors.susceptible })
      ])

      npc.infection = 'exposed'
      dashboard.render()

      expect(heatmap.fills).toEqual([])

      dashboard.setOverlay('heatmapExposed', true)

      const fills = entityLayer.children.flatMap((child) => child.fills)

      expect(fills).toEqual([
        expect.objectContaining({ x: 32, y: 32, color: INFECTION_CONFIG.colors.exposed })
      ])

      dashboard.destroy()
    })

    it('applies radius changes to existing enabled heatmap overlays without rebuilding unrelated tile overlays', () => {
      const entityLayer = createEntityLayer()
      const dashboard = installDebugDashboard(createCity(), entityLayer, {
        heatmapRadius: 16,
        heatmapRadiusRange: { min: 16, max: 64, step: 16 },
        getNpcs: () => [{ infection: 'susceptible', position: { x: 16, y: 16 } }]
      })

      dashboard.setOverlay('tileType', true)
      dashboard.setOverlay('heatmapSusceptible', true)

      const tileChildren = entityLayer.children.filter((child) => child.fills.some((fill) => (
        fill.color === TILE_TYPE_OVERLAY_COLOR_SCHEMES.tileType.sidewalk ||
        fill.color === TILE_TYPE_OVERLAY_COLOR_SCHEMES.tileType.building.residential
      )))
      const heatmap = entityLayer.children.find((child) => (
        child.fills.some((fill) => fill.color === INFECTION_CONFIG.colors.susceptible)
      ))
      const initialHeatmapFillCount = heatmap.fills.length

      dashboard.setHeatmapRadius(64)

      expect(tileChildren.every((child) => entityLayer.children.includes(child))).toBe(true)
      expect(tileChildren.every((child) => child.destroyed)).toBe(false)
      expect(heatmap.fills.length).toBeGreaterThan(initialHeatmapFillCount)

      dashboard.destroy()
    })

    it('destroys all heatmap layers and removes them from the entity layer when the dashboard is destroyed', () => {
      const entityLayer = createEntityLayer()
      const dashboard = installDebugDashboard(createCity(), entityLayer, {
        getNpcs: () => [
          { infection: 'susceptible', position: { x: 16, y: 16 } },
          { infection: 'recovered', position: { x: 48, y: 48 } }
        ]
      })

      dashboard.setOverlay('heatmapSusceptible', true)
      dashboard.setOverlay('heatmapRecovered', true)

      const heatmapChildren = [...entityLayer.children]

      dashboard.destroy()

      expect(entityLayer.children).toHaveLength(0)
      expect(heatmapChildren.every((child) => child.destroyed)).toBe(true)
    })
  })
})
