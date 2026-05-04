export class Game {
  constructor(app, options = {}) {
    this.app = app
    this.systems = []
    this.fixedDeltaSeconds = options.fixedDeltaSeconds || 1 / 60
    this.maxFixedSteps = options.maxFixedSteps || 240
    this.accumulator = 0
    this.paused = false
    this.timeScale = 1
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

  removeSystem(system) {
    const index = this.systems.indexOf(system)

    if (index === -1) {
      return
    }

    this.systems.splice(index, 1)
  }

  start() {
    this.loop.start()
  }

  stop() {
    this.loop.stop()
  }

  play() {
    this.paused = false
    this.start()
  }

  pause() {
    this.paused = true
    this.accumulator = 0
  }

  togglePaused(force) {
    const shouldPause = typeof force === 'boolean' ? force : !this.paused

    if (shouldPause) {
      this.pause()
    } else {
      this.play()
    }
  }

  setSpeed(multiplier) {
    const nextSpeed = Number(multiplier)

    if (!Number.isFinite(nextSpeed) || nextSpeed <= 0) {
      throw new Error('Simulation speed must be a positive number.')
    }

    this.timeScale = nextSpeed
  }

  update(deltaSeconds) {
    if (this.paused) {
      return
    }

    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return
    }

    this.accumulator += deltaSeconds * this.timeScale

    let stepCount = 0

    while (this.accumulator >= this.fixedDeltaSeconds && stepCount < this.maxFixedSteps) {
      this.updateSystems(this.fixedDeltaSeconds)
      this.accumulator -= this.fixedDeltaSeconds
      stepCount += 1
    }

    if (stepCount === this.maxFixedSteps && this.accumulator >= this.fixedDeltaSeconds) {
      this.accumulator = 0
    }
  }

  updateSystems(deltaSeconds) {
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
