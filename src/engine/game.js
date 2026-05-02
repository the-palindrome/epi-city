export class Game {
  constructor(app) {
    this.app = app
    this.systems = []
    this.loop = new GameLoop({
      update: (deltaSeconds) => this.update(deltaSeconds),
      render: () => this.render()
    })
  }

  addSystem(system) {
    if (!system || this.systems.includes(system)) {
      return
    }

    this.systems.push(system)
  }

  start() {
    this.loop.start()
  }

  stop() {
    this.loop.stop()
  }

  update(deltaSeconds) {
    for (const system of this.systems) {
      if (typeof system.update === 'function') {
        system.update(deltaSeconds)
      }
    }
  }

  render() {
    for (const system of this.systems) {
      if (typeof system.render === 'function') {
        system.render()
      }
    }

    this.app.render()
  }

  destroy() {
    this.stop()

    for (const system of this.systems) {
      if (typeof system.destroy === 'function') {
        system.destroy()
      }
    }

    this.systems.length = 0
  }
}

class GameLoop {
  constructor({ update, render, maxDeltaSeconds = 0.1 }) {
    this.update = update
    this.render = render
    this.maxDeltaSeconds = maxDeltaSeconds
    this.running = false
    this.frameRequestId = null
    this.lastFrameTime = null
    this.lastDeltaSeconds = 0
    this.frameCount = 0
    this.tick = this.tick.bind(this)
  }

  start() {
    if (this.running) {
      return
    }

    this.running = true
    this.lastFrameTime = null
    this.frameRequestId = requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false

    if (this.frameRequestId !== null) {
      cancelAnimationFrame(this.frameRequestId)
      this.frameRequestId = null
    }
  }

  getDeltaTime(frameTime) {
    if (this.lastFrameTime === null) {
      this.lastFrameTime = frameTime
      this.lastDeltaSeconds = 0
      return 0
    }

    const rawDeltaSeconds = Math.max(0, (frameTime - this.lastFrameTime) / 1000)

    this.lastFrameTime = frameTime
    this.lastDeltaSeconds = Math.min(rawDeltaSeconds, this.maxDeltaSeconds)
    return this.lastDeltaSeconds
  }

  tick(frameTime) {
    if (!this.running) {
      return
    }

    const deltaSeconds = this.getDeltaTime(frameTime)

    this.update(deltaSeconds)
    this.render()
    this.frameCount += 1
    this.frameRequestId = requestAnimationFrame(this.tick)
  }
}
