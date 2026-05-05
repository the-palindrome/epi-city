import * as PIXI from 'pixi.js'
import {
  CAR_CONFIG,
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
import { createCarSimulation } from './sim/car-simulation.js'
import { createNpcSimulation } from './sim/npc-simulation.js'
import { SimulationClock } from './sim/simulation-clock.js'
import { renderCity } from './render/city-renderer.js'
import { createDayNightOverlay } from './render/day-night-overlay.js'
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
    const entityLayer = new PIXI.Container()

    entityLayer.eventMode = 'none'
    entityLayer.sortableChildren = true
    world.addChild(entityLayer)
    app.stage.addChild(world)

    const camera = createCamera()
    const applyCamera = () => applyCameraToWorld(camera, world)
    const mapData = await loadCityMap(DEFAULT_CITY_MAP_PATHS.tileLayout, DEFAULT_CITY_MAP_PATHS.textureLayout)
    const city = compileCityMap(mapData)
    const textureSet = await loadTextureSet(city.textureSetName)

    validateCityTextureBindings(city, textureSet)
    renderCity(city, entityLayer, textureSet)
    centerCameraOnCity(camera, world, city)

    const game = new Game(app)
    const simulationState = {
      seedEnabled: SIMULATION_CONFIG.seedEnabled,
      seed: SIMULATION_CONFIG.seed,
      speed: SIMULATION_CONFIG.speed,
      npcCount: NPC_CONFIG.count,
      carCount: CAR_CONFIG.count,
      dayNightOverlayEnabled: SIMULATION_CONFIG.dayNightOverlayEnabled
    }
    let npcSimulation = null
    let carSimulation = null
    const simulationClock = new SimulationClock(SIMULATION_CONFIG.clock)
    const dayNightOverlay = createDayNightOverlay(city, entityLayer, simulationClock, {
      enabled: simulationState.dayNightOverlayEnabled
    })

    function createNpcRandom() {
      return simulationState.seedEnabled
        ? createSeededRandom(simulationState.seed)
        : createSystemRandom()
    }

    function createCarRandom() {
      return simulationState.seedEnabled
        ? createSeededRandom(`${simulationState.seed}:cars`)
        : createSystemRandom()
    }

    function createConfiguredNpcSimulation() {
      return createNpcSimulation(city, entityLayer, {
        ...NPC_CONFIG,
        count: simulationState.npcCount,
        clock: simulationClock,
        random: createNpcRandom()
      })
    }

    function createConfiguredCarSimulation() {
      return createCarSimulation(city, entityLayer, {
        ...CAR_CONFIG,
        count: simulationState.carCount,
        clock: simulationClock,
        random: createCarRandom(),
        npcs: npcSimulation ? npcSimulation.npcs : []
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

    function clampNpcCount(count) {
      const { min, max } = SIMULATION_CONFIG.npcCountRange
      const value = Math.round(Number(count))

      if (!Number.isFinite(value)) {
        return min
      }

      return Math.min(Math.max(value, min), max)
    }

    function clampCarCount(count) {
      const { min, max } = SIMULATION_CONFIG.carCountRange
      const value = Math.round(Number(count))

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

      if (carSimulation) {
        game.removeSystem(carSimulation)
        carSimulation.destroy()
      }

      city.resetCrosswalkSignals()
      simulationClock.reset()
      npcSimulation = createConfiguredNpcSimulation()
      carSimulation = createConfiguredCarSimulation()
      game.addSystem(carSimulation)
      game.addSystem(npcSimulation)

      if (window.citySim) {
        window.citySim.npcSimulation = npcSimulation
        window.citySim.carSimulation = carSimulation
      }

      game.render()
    }

    const cameraControls = installCameraControls(app, camera, applyCamera)
    const dashboard = installDebugDashboard(city, entityLayer, {
      paused: game.paused,
      seedEnabled: simulationState.seedEnabled,
      seed: simulationState.seed,
      speed: simulationState.speed,
      speedRange: SIMULATION_CONFIG.speedRange,
      npcCount: simulationState.npcCount,
      npcCountRange: SIMULATION_CONFIG.npcCountRange,
      carCount: simulationState.carCount,
      carCountRange: SIMULATION_CONFIG.carCountRange,
      clock: simulationClock,
      dayNightOverlayEnabled: simulationState.dayNightOverlayEnabled,
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
      },
      onNpcCountChange: (count) => {
        simulationState.npcCount = clampNpcCount(count)
        dashboard.simulation.setNpcCount(simulationState.npcCount)
        restartSimulation()
      },
      onCarCountChange: (count) => {
        simulationState.carCount = clampCarCount(count)
        dashboard.simulation.setCarCount(simulationState.carCount)
        restartSimulation()
      },
      onDayNightOverlayChange: (enabled) => {
        simulationState.dayNightOverlayEnabled = Boolean(enabled)
        dayNightOverlay.setEnabled(simulationState.dayNightOverlayEnabled)
      }
    })

    game.setSpeed(simulationState.speed)
    game.addSystem(simulationClock)
    game.addSystem({ update: (deltaSeconds) => city.updateCrosswalkSignals(deltaSeconds) })
    game.addSystem(dayNightOverlay)
    game.addSystem({ render: () => dashboard.render() })
    npcSimulation = createConfiguredNpcSimulation()
    carSimulation = createConfiguredCarSimulation()
    game.addSystem(carSimulation)
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

    function setNpcCount(count) {
      simulationState.npcCount = clampNpcCount(count)
      dashboard.simulation.setNpcCount(simulationState.npcCount)
      restartSimulation()
    }

    function setCarCount(count) {
      simulationState.carCount = clampCarCount(count)
      dashboard.simulation.setCarCount(simulationState.carCount)
      restartSimulation()
    }

    function setDayNightOverlayEnabled(enabled) {
      simulationState.dayNightOverlayEnabled = Boolean(enabled)
      dayNightOverlay.setEnabled(simulationState.dayNightOverlayEnabled)
      dashboard.simulation.setDayNightOverlayEnabled(simulationState.dayNightOverlayEnabled)
    }

    function destroy() {
      game.destroy()
      dashboard.destroy()
      cameraControls.destroy()
      clearPixiContainer(entityLayer)
      app.destroy({ removeView: true }, { children: true })
      delete window.citySim
    }

    window.citySim = {
      camera,
      city,
      dashboard,
      simulationClock,
      dayNightOverlay,
      gameLoop: game.loop,
      game,
      npcSimulation,
      carSimulation,
      simulationState,
      get npcs() {
        return npcSimulation.npcs
      },
      get cars() {
        return carSimulation.cars
      },
      play: playSimulation,
      pause: pauseSimulation,
      restart: restartSimulation,
      setSpeed: setSimulationSpeed,
      setSeed: setSimulationSeed,
      setSeedEnabled: setSimulationSeedEnabled,
      setNpcCount,
      setCarCount,
      setDayNightOverlayEnabled,
      centerCameraOnCity: () => centerCameraOnCity(camera, world, city),
      destroy
    }

    setStatus('')
  } catch (error) {
    console.error(error)
    setStatus(`${error.message} If you opened this as a file, run npm run dev and load http://localhost:5173 instead.`, true)
  }
}
