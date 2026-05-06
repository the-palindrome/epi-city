import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installEntityContextMenu } from './entity-context-menu.js'

const selectionState = vi.hoisted(() => ({
  hit: null,
  followResult: true
}))

vi.mock('./entity-path-selection.js', () => ({
  findSelectableEntityAt: vi.fn(() => selectionState.hit)
}))

vi.mock('./camera.js', () => ({
  followEntityWithCamera: vi.fn(() => selectionState.followResult)
}))

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.eventListeners = {}
    this.style = {}
    this.hidden = false
    this.offsetWidth = 112
    this.offsetHeight = 64
  }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
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

  contains(target) {
    return target === this || this.children.some((child) => child.contains?.(target))
  }

  focus() {
    this.focused = true
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
}

function createDocument() {
  const body = new FakeElement('body')
  const eventListeners = {}

  return {
    body,
    eventListeners,
    createElement(tagName) {
      return new FakeElement(tagName)
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

function findMenuOption(menu, text) {
  return menu.children.find((child) => child.textContent === text)
}

function contextMenuEvent(overrides = {}) {
  return {
    clientX: 24,
    clientY: 32,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    ...overrides
  }
}

describe('entity context menu', () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  beforeEach(() => {
    selectionState.hit = null
    selectionState.followResult = true
    globalThis.document = createDocument()
    globalThis.window = { innerWidth: 800, innerHeight: 600 }
  })

  afterEach(() => {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  })

  it('adds an NPC-only infect action that manually marks the selected NPC infectious', () => {
    const npc = { id: 7, infection: 'susceptible' }
    const car = { id: 3 }
    const setNpcState = vi.fn((entity, infection) => {
      entity.infection = infection
    })
    const requestRender = vi.fn()
    const canvas = new FakeElement('canvas')
    const menu = installEntityContextMenu({
      app: { canvas },
      camera: { x: 0, y: 0, zoom: 1 },
      city: {},
      world: {},
      getNpcSimulation: () => ({ npcs: [npc], infection: { setNpcState } }),
      getCarSimulation: () => ({ cars: [car] }),
      requestRender
    })
    const event = contextMenuEvent()

    selectionState.hit = { kind: 'npc', entity: npc }
    canvas.eventListeners.contextmenu(event)

    const infectButton = findMenuOption(menu.element, 'infect')

    expect(event.defaultPrevented).toBe(true)
    expect(menu.target).toEqual({ kind: 'npc', id: 7 })
    expect(infectButton.hidden).toBe(false)

    infectButton.eventListeners.click()

    expect(setNpcState).toHaveBeenCalledWith(npc, 'infectious')
    expect(npc.infection).toBe('infectious')
    expect(requestRender).toHaveBeenCalledTimes(1)
    expect(menu.element.hidden).toBe(true)

    selectionState.hit = { kind: 'car', entity: car }
    canvas.eventListeners.contextmenu(contextMenuEvent())

    expect(findMenuOption(menu.element, 'infect').hidden).toBe(true)

    menu.destroy()
  })
})
