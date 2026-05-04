import { describe, expect, it, vi } from 'vitest'
import { Game } from './game.js'

function createGame(options = {}) {
  const app = { render: vi.fn() }

  return {
    app,
    game: new Game(app, { fixedDeltaSeconds: 0.25, ...options })
  }
}

describe('game clock controls', () => {
  it('updates systems on fixed simulation steps', () => {
    const { game } = createGame()
    const system = { update: vi.fn() }

    game.addSystem(system)
    game.update(0.24)
    game.update(0.01)

    expect(system.update).toHaveBeenCalledTimes(1)
    expect(system.update).toHaveBeenCalledWith(0.25)
  })

  it('skips updates while paused but still renders', () => {
    const { app, game } = createGame()
    const system = { update: vi.fn(), render: vi.fn() }

    game.addSystem(system)
    game.pause()
    game.update(1)
    game.render()

    expect(system.update).not.toHaveBeenCalled()
    expect(system.render).toHaveBeenCalledTimes(1)
    expect(app.render).toHaveBeenCalledTimes(1)
  })

  it('scales accumulated simulation time by speed', () => {
    const { game } = createGame()
    const system = { update: vi.fn() }

    game.addSystem(system)
    game.setSpeed(4)
    game.update(0.25)

    expect(system.update).toHaveBeenCalledTimes(4)
  })

  it('removes systems without destroying them', () => {
    const { game } = createGame()
    const system = { update: vi.fn(), destroy: vi.fn() }

    game.addSystem(system)
    game.removeSystem(system)
    game.update(1)

    expect(system.update).not.toHaveBeenCalled()
    expect(system.destroy).not.toHaveBeenCalled()
  })
})
