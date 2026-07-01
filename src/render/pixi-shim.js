export function createGraphicsPixiShim() {
  return {
    Graphics: ShimGraphics
  }
}

export function createSpritePixiShim() {
  return {
    Container: ShimContainer,
    Sprite: ShimSprite,
    Graphics: ShimGraphics,
    Texture: ShimTexture,
    Rectangle: ShimRectangle
  }
}

class ShimContainer {
  constructor() {
    this.children = []
    this.eventMode = 'auto'
    this.parent = null
    this.visible = true
  }

  addChild(child) {
    this.children.push(child)
    child.parent = this
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child)
    child.parent = null
  }

  destroy(options = {}) {
    this.destroyed = true

    if (options.children) {
      for (const child of this.children) {
        child.destroy?.()
      }
    }
  }
}

class ShimSprite {
  constructor(texture = null) {
    this.texture = texture
    this.visible = true
    this.anchor = {
      set: (value) => {
        this.anchorValue = value
      }
    }
  }

  destroy() {
    this.destroyed = true
  }
}

class ShimGraphics {
  constructor() {
    this.children = []
    this.eventMode = 'auto'
    this.parent = null
    this.visible = true
    this.fills = []
    this.rects = []
    this.circles = []
    this.strokes = []
    this.drawnRects = 0
  }

  clear() {
    this.fills.length = 0
    this.rects.length = 0
    this.circles.length = 0
    this.strokes.length = 0
    this.drawnRects = 0
    return this
  }

  rect(x = 0, y = 0, width = 0, height = 0) {
    const shape = { x, y, width, height }

    this.rects.push(shape)
    this.drawnRects += 1
    return this.createShapeChain(shape)
  }

  circle(x = 0, y = 0, radius = 0) {
    const shape = { x, y, radius }

    this.circles.push(shape)
    return this.createShapeChain(shape)
  }

  moveTo(x = 0, y = 0) {
    this.currentPath = [{ x, y }]
    return this
  }

  lineTo(x = 0, y = 0) {
    if (!this.currentPath) {
      this.currentPath = []
    }

    this.currentPath.push({ x, y })
    return this
  }

  stroke(options = {}) {
    this.strokes.push({
      path: this.currentPath ? [...this.currentPath] : [],
      options
    })
    return this
  }

  fill(options = {}) {
    this.fills.push(options)
    return this
  }

  destroy() {
    this.destroyed = true
  }

  createShapeChain(shape) {
    return {
      fill: (options = {}) => {
        shape.fill = options
        this.fills.push(options)
        return this
      },
      stroke: (options = {}) => {
        shape.stroke = options
        this.strokes.push({ shape, options })
        return this
      }
    }
  }
}

class ShimTexture {
  constructor(options = {}) {
    this.source = options.source || {}
    this.frame = options.frame || null
  }

  static from(resource) {
    return {
      resource,
      source: {
        style: {
          update() {}
        }
      }
    }
  }
}

ShimTexture.EMPTY = { empty: true }

class ShimRectangle {
  constructor(x, y, width, height) {
    this.x = x
    this.y = y
    this.width = width
    this.height = height
  }
}
