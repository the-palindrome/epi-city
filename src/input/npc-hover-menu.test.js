import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installNpcHoverMenu } from './npc-hover-menu.js'

const selectionState = vi.hoisted(() => ({
  hit: null
}))

vi.mock('./entity-path-selection.js', () => ({
  findSelectableEntityAt: vi.fn(() => selectionState.hit)
}))

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.eventListeners = {}
    this.style = {}
    this.hidden = false
    this.offsetWidth = 174
    this.offsetHeight = 128
    this._textContent = ''
  }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
  }

  replaceChildren(...children) {
    this.children = []

    for (const child of children) {
      this.appendChild(child)
    }
  }

  addEventListener(type, listener) {
    this.eventListeners[type] = listener
  }

  removeEventListener(type, listener) {
    if (this.eventListeners[type] === listener) {
      delete this.eventListeners[type]
    }
  }

  setAttribute(name, value) {
    this[name] = value
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
      this.parentNode = null
    }
  }

  getBoundingClientRect() {
    return { left: 0, top: 0 }
  }

  set textContent(value) {
    this._textContent = String(value)
    this.children = []
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`
  }
}

function createDocument() {
  const body = new FakeElement('body')

  return {
    body,
    createElement(tagName) {
      return new FakeElement(tagName)
    }
  }
}

function mouseEvent(overrides = {}) {
  return {
    clientX: 24,
    clientY: 32,
    ...overrides
  }
}

describe('NPC hover menu', () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  let animationFrame = null

  beforeEach(() => {
    selectionState.hit = null
    animationFrame = null
    globalThis.document = createDocument()
    globalThis.window = { innerWidth: 800, innerHeight: 600 }
    globalThis.requestAnimationFrame = (callback) => {
      animationFrame = callback
      return 1
    }
    globalThis.cancelAnimationFrame = () => {
      animationFrame = null
    }
  })

  afterEach(() => {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('renders full status for the hovered NPC and hides off NPCs', () => {
    const npc = {
      id: 2,
      age: 12,
      home: 'home-7',
      work: null,
      timetable: {
        elements: [
          { id: 'home', buildingId: 'home-7' },
          { id: 'school', buildingId: 'school-3' }
        ]
      },
      present: false,
      locationState: {
        buildingId: 'school-3'
      },
      goal: {
        id: 'school',
        buildingId: 'school-3'
      },
      carId: null
    }
    const car = { id: 4 }
    const canvas = new FakeElement('canvas')
    const menu = installNpcHoverMenu({
      app: { canvas },
      camera: { x: 0, y: 0, zoom: 1 },
      city: {},
      getNpcSimulation: () => ({
        npcs: [npc],
        infection: {
          getNpcStatus: () => ({
            id: 2,
            infection: 'exposed',
            color: 0xf0a33a,
            contagious: false,
            canBeInfected: false,
            immune: false,
            nextState: 'infectious',
            remainingSeconds: 2 * 24 * 60 * 60,
            remainingDays: 2
          })
        }
      }),
      getCarSimulation: () => ({ cars: [car] })
    })

    selectionState.hit = { kind: 'npc', entity: npc }
    canvas.eventListeners.mousemove(mouseEvent())
    animationFrame()

    expect(menu.targetId).toBe(2)
    expect(menu.element.hidden).toBe(false)
    expect(menu.element.textContent).toContain('NPC 2')
    expect(menu.element.textContent).toContain('age')
    expect(menu.element.textContent).toContain('12')
    expect(menu.element.textContent).toContain('home')
    expect(menu.element.textContent).toContain('home-7')
    expect(menu.element.textContent).toContain('work')
    expect(menu.element.textContent).toContain('school')
    expect(menu.element.textContent).toContain('school-3')
    expect(menu.element.textContent).toContain('lunch')
    expect(menu.element.textContent).toContain('shopping')
    expect(menu.element.textContent).toContain('nightlife')
    expect(menu.element.textContent).toContain('current')
    expect(menu.element.textContent).toContain('inside school-3')
    expect(menu.element.textContent).toContain('goal')
    expect(menu.element.textContent).toContain('school school-3')
    expect(menu.element.textContent).toContain('car')
    expect(menu.element.textContent).toContain('health')
    expect(menu.element.textContent).toContain('Exposed')
    expect(menu.element.textContent).toContain('health note')
    expect(menu.element.textContent).toContain('Incubating; not contagious yet')
    expect(menu.element.textContent).toContain('next change')
    expect(menu.element.textContent).toContain('Infectious in')
    expect(menu.element.textContent).toContain('2 days')
    expect(menu.element.textContent).not.toContain('can be infected')
    expect(menu.element.textContent).not.toContain('phase timer')

    selectionState.hit = { kind: 'car', entity: car }
    canvas.eventListeners.mousemove(mouseEvent())
    animationFrame()

    expect(menu.targetId).toBeNull()
    expect(menu.element.hidden).toBe(true)

    menu.destroy()
  })
})
