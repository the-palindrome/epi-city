import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCameraFollow,
  followEntityWithCamera,
  installCameraControls,
  refreshFollowedCamera
} from './camera.js'

class FakeEventTarget {
  constructor(properties = {}) {
    Object.assign(this, properties)
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []

    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []

    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener))
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event)
    }
  }
}

const originalWindow = globalThis.window

describe('camera follow', () => {
  let fakeWindow

  beforeEach(() => {
    fakeWindow = new FakeEventTarget({
      innerWidth: 200,
      innerHeight: 100
    })
    globalThis.window = fakeWindow
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = originalWindow
    }
  })

  it('centers the camera on a followable entity position', () => {
    const camera = createTestCamera({ zoom: 2 })
    const world = createTestWorld()
    const entity = { position: { x: 200, y: 150 } }

    expect(followEntityWithCamera(camera, world, entity)).toBe(true)
    expect(camera.followedEntity).toBe(entity)
    expect(camera.x).toBe(-300)
    expect(camera.y).toBe(-250)
    expect(world.position).toMatchObject({ x: -300, y: -250 })
    expect(world.scale.value).toBe(2)
  })

  it('keeps following as the entity moves', () => {
    const entity = { position: { x: 200, y: 150 } }
    const camera = createTestCamera({ zoom: 2, followedEntity: entity })
    const world = createTestWorld()

    entity.position = { x: 210, y: 175 }

    expect(refreshFollowedCamera(camera, world)).toBe(true)
    expect(camera.x).toBe(-320)
    expect(camera.y).toBe(-300)
  })

  it('clears follow when the entity cannot be followed', () => {
    const camera = createTestCamera({
      followedEntity: {
        present: false,
        position: { x: 200, y: 150 }
      }
    })
    const world = createTestWorld()

    expect(refreshFollowedCamera(camera, world)).toBe(false)
    expect(camera.followedEntity).toBeNull()
  })

  it('turns follow off when panning moves the camera laterally', () => {
    const canvas = createCanvas()
    const camera = createTestCamera({
      followedEntity: {
        position: { x: 200, y: 150 }
      }
    })
    const applyCamera = vi.fn()

    installCameraControls({ canvas }, camera, applyCamera)

    canvas.emit('mousedown', mouseEvent({ button: 0, clientX: 10, clientY: 10 }))
    fakeWindow.emit('mousemove', mouseEvent({ clientX: 16, clientY: 8 }))

    expect(camera.followedEntity).toBeNull()
    expect(camera.x).toBe(6)
    expect(camera.y).toBe(-2)
    expect(applyCamera).toHaveBeenCalledTimes(1)
  })

  it('keeps follow active while zooming', () => {
    const canvas = createCanvas()
    const entity = { position: { x: 200, y: 150 } }
    const camera = createTestCamera({ followedEntity: entity })
    const applyCamera = vi.fn()
    const applyCameraFollow = vi.fn()

    installCameraControls({ canvas }, camera, applyCamera, { applyCameraFollow })

    canvas.emit('wheel', mouseEvent({ deltaY: -100, clientX: 20, clientY: 20 }))

    expect(camera.followedEntity).toBe(entity)
    expect(camera.zoom).toBeGreaterThan(1)
    expect(applyCamera).not.toHaveBeenCalled()
    expect(applyCameraFollow).toHaveBeenCalledTimes(1)
  })

  it('can clear follow directly', () => {
    const camera = createTestCamera({ followedEntity: { position: { x: 1, y: 2 } } })

    clearCameraFollow(camera)

    expect(camera.followedEntity).toBeNull()
  })
})

function createTestCamera(overrides = {}) {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.08,
    maxZoom: 8,
    worldWidth: 1000,
    worldHeight: 1000,
    followedEntity: null,
    ...overrides
  }
}

function createTestWorld() {
  return {
    position: {
      x: 0,
      y: 0,
      set(x, y) {
        this.x = x
        this.y = y
      }
    },
    scale: {
      value: 1,
      set(value) {
        this.value = value
      }
    }
  }
}

function createCanvas() {
  return new FakeEventTarget({
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  })
}

function mouseEvent(properties = {}) {
  return {
    preventDefault: vi.fn(),
    ...properties
  }
}
