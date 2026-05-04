import * as PIXI from 'pixi.js'
import {
  DEFAULT_CITY_MAP_PATHS,
  NPC_CONFIG,
  SIMULATION_CONFIG
} from './core/constants.js'
import { createSeededRandom, createSystemRandom } from './core/random.js'
import { Game } from './engine/game.js'
import {
  applyCameraToWorld,
  centerCameraOnCity,
  createCamera,
  installCameraControls
} from './input/camera.js'
import {
  compileCityMap,
  loadCityMap,
  validateCityTextureBindings
} from './map/city-map.js'
import { installDebugDashboard } from './debug/dashboard.js'
import { createNpcSimulation } from './sim/npc-simulation.js'
import { renderCity } from './render/city-renderer.js'
import {
  clearPixiContainer,
  configurePixelArtRendering,
  loadTextureSet
} from './render/pixi-rendering.js'

configurePixelArtRendering()
main()

async function main() {
  const status = document.getElementById('status')
  const app = new PIXI.Application()

  function setStatus(message, isError = false) {
    status.textContent = message
    status.classList.toggle('error', isError)
    status.classList.toggle('hidden', !message)
  }

  try {
    await app.init({
      background: '#ffffff',
      resizeTo: window,
      autoStart: false,
      autoDensity: true,
      antialias: false,
      roundPixels: true,
      resolution: window.devicePixelRatio || 1
    })

    app.stop()
    document.body.appendChild(app.canvas)

    const world = new PIXI.Container()
    const mapLayer = new PIXI.Container()
    const overlayLayer = new PIXI.Container()
    const actorLayer = new PIXI.Container()

    world.addChild(mapLayer)
    world.addChild(overlayLayer)
    world.addChild(actorLayer)
    app.stage.addChild(world)

    const camera = createCamera()
    const applyCamera = () => applyCameraToWorld(camera, world)
    const mapData = await loadCityMap(DEFAULT_CITY_MAP_PATHS.tileLayout, DEFAULT_CITY_MAP_PATHS.textureLayout)
    const city = compileCityMap(mapData)
    const textureSet = await loadTextureSet(city.textureSetName)

    validateCityTextureBindings(city, textureSet)
    renderCity(city, mapLayer, textureSet)
    centerCameraOnCity(camera, world, city)

    const game = new Game(app)
    const simulationState = {
      seedEnabled: SIMULATION_CONFIG.seedEnabled,
      seed: SIMULATION_CONFIG.seed,
      speed: SIMULATION_CONFIG.speed
    }
    let npcSimulation = null

    function createNpcRandom() {
      return simulationState.seedEnabled
        ? createSeededRandom(simulationState.seed)
        : createSystemRandom()
    }

    function createConfiguredNpcSimulation() {
      return createNpcSimulation(city, actorLayer, {
        ...NPC_CONFIG,
        random: createNpcRandom()
      })
    }

    function clampSimulationSpeed(speed) {
      const { min, max } = SIMULATION_CONFIG.speedRange
      const value = Number(speed)

      if (!Number.isFinite(value)) {
        return min
      }

      return Math.min(Math.max(value, min), max)
    }

    function restartSimulation() {
      if (npcSimulation) {
        game.removeSystem(npcSimulation)
        npcSimulation.destroy()
      }

      city.resetCrosswalkSignals()
      npcSimulation = createConfiguredNpcSimulation()
      game.addSystem(npcSimulation)

      if (window.citySim) {
        window.citySim.npcSimulation = npcSimulation
      }

      game.render()
    }

    const cameraControls = installCameraControls(app, camera, applyCamera)
    const dashboard = installDebugDashboard(city, overlayLayer, {
      paused: game.paused,
      seedEnabled: simulationState.seedEnabled,
      seed: simulationState.seed,
      speed: simulationState.speed,
      speedRange: SIMULATION_CONFIG.speedRange,
      onPlay: () => game.play(),
      onPause: () => game.pause(),
      onRestart: restartSimulation,
      onSeedEnabledChange: (enabled) => {
        simulationState.seedEnabled = enabled
      },
      onSeedChange: (seed) => {
        simulationState.seed = seed
      },
      onSpeedChange: (speed) => {
        simulationState.speed = speed
        game.setSpeed(speed)
      }
    })

    game.setSpeed(simulationState.speed)
    game.addSystem({ update: (deltaSeconds) => city.updateCrosswalkSignals(deltaSeconds) })
    npcSimulation = createConfiguredNpcSimulation()
    game.addSystem(npcSimulation)
    game.start()

    function playSimulation() {
      game.play()
      dashboard.simulation.setPaused(false)
    }

    function pauseSimulation() {
      game.pause()
      dashboard.simulation.setPaused(true)
    }

    function setSimulationSpeed(speed) {
      const nextSpeed = clampSimulationSpeed(speed)

      game.setSpeed(nextSpeed)
      simulationState.speed = nextSpeed
      dashboard.simulation.setSpeed(simulationState.speed)
    }

    function setSimulationSeed(seed) {
      simulationState.seed = String(seed)
      dashboard.simulation.setSeed(simulationState.seed)
    }

    function setSimulationSeedEnabled(enabled) {
      simulationState.seedEnabled = Boolean(enabled)
      dashboard.simulation.setSeedEnabled(simulationState.seedEnabled)
    }

    function destroy() {
      game.destroy()
      dashboard.destroy()
      cameraControls.destroy()
      clearPixiContainer(mapLayer)
      clearPixiContainer(overlayLayer)
      clearPixiContainer(actorLayer)
      app.destroy({ removeView: true }, { children: true })
      delete window.citySim
    }

    window.citySim = {
      camera,
      city,
      dashboard,
      gameLoop: game.loop,
      game,
      npcSimulation,
      simulationState,
      get npcs() {
        return npcSimulation.npcs
      },
      play: playSimulation,
      pause: pauseSimulation,
      restart: restartSimulation,
      setSpeed: setSimulationSpeed,
      setSeed: setSimulationSeed,
      setSeedEnabled: setSimulationSeedEnabled,
      centerCameraOnCity: () => centerCameraOnCity(camera, world, city),
      destroy
    }

    setStatus('')
  } catch (error) {
    console.error(error)
    setStatus(`${error.message} If you opened this as a file, run npm run dev and load http://localhost:5173 instead.`, true)
  }
}
