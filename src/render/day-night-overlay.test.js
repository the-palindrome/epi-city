import { describe, expect, it, vi } from 'vitest'
import { createDayNightOverlay, dayNightOverlayAlpha } from './day-night-overlay.js'

vi.mock('pixi.js', () => ({
  Graphics: class {
    constructor() {
      this.eventMode = 'auto'
      this.parent = null
      this.visible = true
      this.alpha = 1
      this.rects = []
    }

    rect(x, y, width, height) {
      this.rects.push({ x, y, width, height })

      return {
        fill: (style) => {
          this.fill = style
        }
      }
    }

    destroy() {
      this.destroyed = true
    }
  }
}))

function createEntityLayer() {
  return {
    children: [],
    sortableChildren: false,
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

describe('day-night overlay', () => {
  it('is clear at midday and darkest near midnight', () => {
    expect(dayNightOverlayAlpha(12)).toBe(0)
    expect(dayNightOverlayAlpha(0)).toBeCloseTo(0.48)
    expect(dayNightOverlayAlpha(20)).toBeGreaterThan(dayNightOverlayAlpha(16))
  })

  it('renders a removable city-sized overlay controlled by the clock', () => {
    const city = { width: 2, height: 3, tileSize: 32 }
    const layer = createEntityLayer()
    const clock = {
      hour: 0,
      getTimeOfDayHours() {
        return this.hour
      }
    }
    const overlay = createDayNightOverlay(city, layer, clock)

    expect(layer.sortableChildren).toBe(true)
    expect(layer.children).toEqual([overlay.graphics])
    expect(overlay.graphics.rects).toEqual([{ x: 0, y: 0, width: 64, height: 96 }])
    expect(overlay.graphics.visible).toBe(true)
    expect(overlay.graphics.alpha).toBeCloseTo(0.48)

    clock.hour = 12
    overlay.render()

    expect(overlay.graphics.visible).toBe(false)
    expect(overlay.graphics.alpha).toBe(0)

    clock.hour = 0
    overlay.setEnabled(false)

    expect(overlay.enabled).toBe(false)
    expect(overlay.graphics.visible).toBe(false)
    expect(overlay.graphics.alpha).toBe(0)

    overlay.destroy()

    expect(layer.children).toEqual([])
    expect(overlay.graphics.destroyed).toBe(true)
  })
})
