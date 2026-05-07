import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TILE_TYPE_OVERLAY_COLORS } from '../core/constants.js'
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
    this.eventListeners = {}
    this.isContentEditable = false
  }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener
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
  const eventListeners = {}

  return {
    dashboard,
    overlayDashboard,
    eventListeners,
    createElement(tagName) {
      return new FakeElement(tagName)
    },
    getElementById(id) {
      if (id === 'debug-dashboard') {
        return dashboard
      }

      if (id === 'overlay-dashboard') {
        return overlayDashboard
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

  it('renders the overlays title and o shortcut on the overlay dashboard', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const title = dashboard.overlayElement.children[0]
    const shortcut = title.children[0]
    const overlayToggle = findByDataset(dashboard.overlayElement, 'overlayToggle')

    expect(title.className).toBe('dashboard-title')
    expect(title.textContent).toBe('overlays')
    expect(shortcut.className).toBe('dashboard-shortcut')
    expect(shortcut.textContent).toBe('o')
    expect(findByDataset(dashboard.element, 'overlayToggle')).toBeNull()
    expect(overlayToggle).not.toBeNull()
    expect(overlayToggle.dataset.overlayToggle).toBe('tileType')
    expect(findByDataset(dashboard.overlayElement, 'tileTypeOverlayOpacity')).not.toBeNull()

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

  it('toggles the overlay dashboard with the o hotkey', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown

    const hideEvent = createKeydownEvent({ key: 'o', code: 'KeyO' })
    keydown(hideEvent)

    expect(hideEvent.defaultPrevented).toBe(true)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(true)
    expect(dashboard.element.classList.contains('hidden')).toBe(false)

    const showEvent = createKeydownEvent({ key: 'O', code: 'KeyO' })
    keydown(showEvent)

    expect(showEvent.defaultPrevented).toBe(true)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(false)

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

  it('does not toggle the overlay dashboard with the o hotkey inside editable controls', () => {
    const dashboard = installDebugDashboard(createCity(), createEntityLayer())
    const keydown = globalThis.document.eventListeners.keydown
    const seedInput = findByDataset(dashboard.element, 'simulationSeed')

    const inputEvent = createKeydownEvent({ key: 'o', code: 'KeyO', target: seedInput })
    keydown(inputEvent)

    expect(inputEvent.defaultPrevented).toBe(false)
    expect(dashboard.overlayElement.classList.contains('hidden')).toBe(false)

    dashboard.destroy()
  })

  it('renders tile type overlay chunks at the z-order of their covered tiles', () => {
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

  it('colors tile type overlays by category, building type, and opacity', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createTileOverlayColorCity(), entityLayer)

    dashboard.setOverlay('tileType', true)

    const fills = entityLayer.children.flatMap((child) => child.fills)
    const fillAt = (x, y) => fills.find((fill) => fill.x === x * 32 && fill.y === y * 32)

    expect(fillAt(0, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLORS.sidewalk,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(1, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLORS.road,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(2, 0)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLORS.building.residential,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })
    expect(fillAt(0, 1)).toMatchObject({
      color: TILE_TYPE_OVERLAY_COLORS.building.commercial,
      alpha: TILE_TYPE_OVERLAY_COLORS.alpha
    })

    dashboard.destroy()
  })

  it('updates the tile type overlay opacity from the overlay dashboard slider', () => {
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
      incubationDays: 5,
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
    expect(incubationDays.value).toBe('5')
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
})
