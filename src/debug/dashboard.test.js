import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCityMap, validateCityMap } from '../map/city-map.js'
import { installDebugDashboard } from './dashboard.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.visible = true
    }

    rect() {
      return {
        fill() {}
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

  return {
    dashboard,
    createElement(tagName) {
      return new FakeElement(tagName)
    },
    getElementById(id) {
      return id === 'debug-dashboard' ? dashboard : null
    },
    addEventListener() {},
    removeEventListener() {}
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

describe('debug dashboard overlays', () => {
  const originalDocument = globalThis.document

  beforeEach(() => {
    globalThis.document = createDashboardDocument()
  })

  afterEach(() => {
    globalThis.document = originalDocument
  })

  it('renders overlay chunks at the z-order of their covered tiles', () => {
    const entityLayer = createEntityLayer()
    const dashboard = installDebugDashboard(createCity(), entityLayer)

    dashboard.setOverlay('walkable', true)

    const overlayZorders = entityLayer.children.map((child) => child.zorder).sort((a, b) => a - b)

    expect(overlayZorders).toEqual([0, 2])
    expect(entityLayer.sortableChildren).toBe(true)
    expect(entityLayer.children.every((child) => child.zIndex === child.zorder)).toBe(true)

    dashboard.setOverlay('walkable', false)

    expect(entityLayer.children.map((child) => child.visible)).toEqual([false, false])

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
})
