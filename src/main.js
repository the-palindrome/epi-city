import * as PIXI from 'pixi.js'
import {
  CAR_CONFIG,
  DEFAULT_CITY_MAP_PATHS,
  ENTITY_RENDER_MODE_ID,
  INFECTION_CONFIG,
  NPC_CONFIG,
  SEIR_HEATMAP_CONFIG,
  SIMULATION_CONFIG
} from './core/constants.js'
import { createSeededRandom, createSystemRandom } from './core/random.js'
import { Game } from './engine/game.js'
import {
  applyCameraToWorld,
  centerCameraOnCity,
  clearCameraFollow,
  createCamera,
  followEntityWithCamera,
  installCameraControls,
  refreshFollowedCamera
} from './input/camera.js'
import { installEntityContextMenu } from './input/entity-context-menu.js'
import { installNpcHoverMenu } from './input/npc-hover-menu.js'
import { createEntityPathSelection } from './input/entity-path-selection.js'
import {
  compileCityMap,
  loadCityMap,
  validateCityTextureBindings
} from './map/city-map.js'
import { installDebugDashboard } from './debug/dashboard.js'
import { createCarSimulation } from './sim/car-simulation.js'
import { createNpcSimulation } from './sim/npc-simulation.js'
import { createSignalUpdateSystem } from './sim/signal-update-system.js'
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

    document.body.appendChild(app.canvas)

    const world = new PIXI.Container()
    const entityLayer = new PIXI.Container()

    entityLayer.eventMode = 'none'
    entityLayer.sortableChildren = true
    world.addChild(entityLayer)
    app.stage.addChild(world)

    const camera = createCamera()
    const applyCamera = () => applyCameraToWorld(camera, world)
    const applyCameraFollow = () => {
      if (!refreshFollowedCamera(camera, world)) {
        applyCamera()
      }
    }
    const mapData = await loadCityMap(DEFAULT_CITY_MAP_PATHS.tileLayout, DEFAULT_CITY_MAP_PATHS.textureLayout)
    const city = compileCityMap(mapData)
    const textureSet = await loadTextureSet(city.textureSetName)

    validateCityTextureBindings(city, textureSet)
    const mapTextures = renderCity(city, entityLayer, textureSet)
    centerCameraOnCity(camera, world, city)

    const game = new Game(app)
    const simulationState = {
      seedEnabled: SIMULATION_CONFIG.seedEnabled,
      seed: SIMULATION_CONFIG.seed,
      speed: SIMULATION_CONFIG.speed,
      npcCount: NPC_CONFIG.count,
      carCount: CAR_CONFIG.count,
      initialInfectiousCount: INFECTION_CONFIG.initialInfectiousCount,
      infectionDistance: INFECTION_CONFIG.infectionDistance,
      infectionProbability: INFECTION_CONFIG.infectionProbability,
      incubationDays: INFECTION_CONFIG.incubationDays,
      infectionDays: INFECTION_CONFIG.infectionDays,
      immunityDays: INFECTION_CONFIG.immunityDays,
      dayNightOverlayEnabled: SIMULATION_CONFIG.dayNightOverlayEnabled,
      mapTextureEnabled: true,
      mapTextureOpacity: 1,
      entityRenderMode: ENTITY_RENDER_MODE_ID,
      heatmapRadius: SEIR_HEATMAP_CONFIG.radius
    }
    let npcSimulation = null
    let carSimulation = null
    const simulationClock = new SimulationClock(SIMULATION_CONFIG.clock)
    const dayNightOverlay = createDayNightOverlay(city, entityLayer, simulationClock, {
      enabled: simulationState.dayNightOverlayEnabled
    })
    let entityContextMenu = null
    let npcHoverMenu = null
    const pathSelection = createEntityPathSelection({
      app,
      camera,
      city,
      entityLayer,
      getNpcSimulation: () => npcSimulation,
      getCarSimulation: () => carSimulation,
      requestRender: () => game.render()
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
        initialInfectiousCount: simulationState.initialInfectiousCount,
        infectionDistance: simulationState.infectionDistance,
        infectionProbability: simulationState.infectionProbability,
        incubationDays: simulationState.incubationDays,
        infectionDays: simulationState.infectionDays,
        immunityDays: simulationState.immunityDays,
        clock: simulationClock,
        random: createNpcRandom(),
        entityRenderMode: simulationState.entityRenderMode
      })
    }

    function createConfiguredCarSimulation() {
      return createCarSimulation(city, entityLayer, {
        ...CAR_CONFIG,
        count: simulationState.carCount,
        clock: simulationClock,
        random: createCarRandom(),
        npcs: npcSimulation ? npcSimulation.npcs : [],
        entityRenderMode: simulationState.entityRenderMode
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

    function clampInitialInfectiousCount(count) {
      const { min, max } = INFECTION_CONFIG.initialInfectiousCountRange
      const value = Math.round(Number(count))

      if (!Number.isFinite(value)) {
        return min
      }

      return Math.min(Math.max(value, min), Math.min(max, simulationState.npcCount))
    }

    function clampInfectionDistance(distance) {
      return clampRangeValue(distance, INFECTION_CONFIG.infectionDistanceRange)
    }

    function clampInfectionProbability(probability) {
      return clampRangeValue(probability, INFECTION_CONFIG.infectionProbabilityRange)
    }

    function clampIncubationDays(days) {
      return clampRangeValue(days, INFECTION_CONFIG.incubationDaysRange)
    }

    function clampInfectionDays(days) {
      return clampRangeValue(days, INFECTION_CONFIG.infectionDaysRange)
    }

    function clampImmunityDays(days) {
      return clampRangeValue(days, INFECTION_CONFIG.immunityDaysRange)
    }

    function clampRenderingOpacity(opacity) {
      return clampRangeValue(opacity, { min: 0, max: 1 })
    }

    function clampRangeValue(value, range) {
      const number = Number(value)

      if (!Number.isFinite(number)) {
        return range.min
      }

      return Math.min(Math.max(number, range.min), range.max)
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
      city.resetTrafficSignals()
      clearCameraFollow(camera)
      entityContextMenu?.hide()
      pathSelection.clearSelection()
      simulationClock.reset()
      npcSimulation = createConfiguredNpcSimulation()
      carSimulation = createConfiguredCarSimulation()
      game.addSystem(carSimulation)
      game.addSystem(npcSimulation)

      game.render()
    }

    const cameraControls = installCameraControls(app, camera, applyCamera, { applyCameraFollow })
    entityContextMenu = installEntityContextMenu({
      app,
      camera,
      city,
      world,
      getNpcSimulation: () => npcSimulation,
      getCarSimulation: () => carSimulation,
      requestRender: () => game.render()
    })
    npcHoverMenu = installNpcHoverMenu({
      app,
      camera,
      city,
      getNpcSimulation: () => npcSimulation,
      getCarSimulation: () => carSimulation
    })
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
      initialInfectiousCount: simulationState.initialInfectiousCount,
      initialInfectiousCountRange: INFECTION_CONFIG.initialInfectiousCountRange,
      infectionDistance: simulationState.infectionDistance,
      infectionDistanceRange: INFECTION_CONFIG.infectionDistanceRange,
      infectionProbability: simulationState.infectionProbability,
      infectionProbabilityRange: INFECTION_CONFIG.infectionProbabilityRange,
      incubationDays: simulationState.incubationDays,
      incubationDaysRange: INFECTION_CONFIG.incubationDaysRange,
      infectionDays: simulationState.infectionDays,
      infectionDaysRange: INFECTION_CONFIG.infectionDaysRange,
      immunityDays: simulationState.immunityDays,
      immunityDaysRange: INFECTION_CONFIG.immunityDaysRange,
      getInfectionStats: () => npcSimulation?.infection.getStats(),
      getNpcs: () => npcSimulation?.npcs || [],
      clock: simulationClock,
      dayNightOverlayEnabled: simulationState.dayNightOverlayEnabled,
      mapTextureEnabled: simulationState.mapTextureEnabled,
      mapTextureOpacity: simulationState.mapTextureOpacity,
      entityRenderMode: simulationState.entityRenderMode,
      heatmapRadius: simulationState.heatmapRadius,
      heatmapRadiusRange: SEIR_HEATMAP_CONFIG.radiusRange,
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
        simulationState.initialInfectiousCount = clampInitialInfectiousCount(simulationState.initialInfectiousCount)
        dashboard.simulation.setNpcCount(simulationState.npcCount)
        dashboard.simulation.setInitialInfectiousCount(simulationState.initialInfectiousCount)
        restartSimulation()
      },
      onCarCountChange: (count) => {
        simulationState.carCount = clampCarCount(count)
        dashboard.simulation.setCarCount(simulationState.carCount)
        restartSimulation()
      },
      onInitialInfectiousCountChange: (count) => {
        simulationState.initialInfectiousCount = clampInitialInfectiousCount(count)
        dashboard.simulation.setInitialInfectiousCount(simulationState.initialInfectiousCount)
        restartSimulation()
      },
      onInfectionDistanceChange: (distance) => {
        simulationState.infectionDistance = clampInfectionDistance(distance)
        dashboard.simulation.setInfectionDistance(simulationState.infectionDistance)
        restartSimulation()
      },
      onInfectionProbabilityChange: (probability) => {
        simulationState.infectionProbability = clampInfectionProbability(probability)
        dashboard.simulation.setInfectionProbability(simulationState.infectionProbability)
        restartSimulation()
      },
      onIncubationDaysChange: (days) => {
        simulationState.incubationDays = clampIncubationDays(days)
        dashboard.simulation.setIncubationDays(simulationState.incubationDays)
        restartSimulation()
      },
      onInfectionDaysChange: (days) => {
        simulationState.infectionDays = clampInfectionDays(days)
        dashboard.simulation.setInfectionDays(simulationState.infectionDays)
        restartSimulation()
      },
      onImmunityDaysChange: (days) => {
        simulationState.immunityDays = clampImmunityDays(days)
        dashboard.simulation.setImmunityDays(simulationState.immunityDays)
        restartSimulation()
      },
      onDayNightOverlayChange: (enabled) => {
        simulationState.dayNightOverlayEnabled = Boolean(enabled)
        dayNightOverlay.setEnabled(simulationState.dayNightOverlayEnabled)
      },
      onMapTextureEnabledChange: (enabled) => {
        simulationState.mapTextureEnabled = Boolean(enabled)
        mapTextures.setVisible(simulationState.mapTextureEnabled)
        game.render()
      },
      onMapTextureOpacityChange: (opacity) => {
        simulationState.mapTextureOpacity = clampRenderingOpacity(opacity)
        mapTextures.setOpacity(simulationState.mapTextureOpacity)
        game.render()
      },
      onEntityRenderModeChange: (mode) => {
        simulationState.entityRenderMode = mode
        npcSimulation?.setEntityRenderMode(mode)
        carSimulation?.setEntityRenderMode(mode)
        game.render()
      },
      onHeatmapRadiusChange: (radius) => {
        simulationState.heatmapRadius = clampRangeValue(radius, SEIR_HEATMAP_CONFIG.radiusRange)
        game.render()
      }
    })

    game.setSpeed(simulationState.speed)
    game.addSystem(simulationClock)
    game.addSystem(createSignalUpdateSystem(city, simulationClock))
    game.addSystem(dayNightOverlay)
    game.addSystem({ render: () => dashboard.render() })
    npcSimulation = createConfiguredNpcSimulation()
    carSimulation = createConfiguredCarSimulation()
    game.addSystem(carSimulation)
    game.addSystem(npcSimulation)
    game.addSystem(pathSelection)
    game.addSystem({ render: applyCameraFollow })
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
      simulationState.initialInfectiousCount = clampInitialInfectiousCount(simulationState.initialInfectiousCount)
      dashboard.simulation.setNpcCount(simulationState.npcCount)
      dashboard.simulation.setInitialInfectiousCount(simulationState.initialInfectiousCount)
      restartSimulation()
    }

    function setCarCount(count) {
      simulationState.carCount = clampCarCount(count)
      dashboard.simulation.setCarCount(simulationState.carCount)
      restartSimulation()
    }

    function setInitialInfectiousCount(count) {
      simulationState.initialInfectiousCount = clampInitialInfectiousCount(count)
      dashboard.simulation.setInitialInfectiousCount(simulationState.initialInfectiousCount)
      restartSimulation()
    }

    function setInfectionDistance(distance) {
      simulationState.infectionDistance = clampInfectionDistance(distance)
      dashboard.simulation.setInfectionDistance(simulationState.infectionDistance)
      restartSimulation()
    }

    function setInfectionProbability(probability) {
      simulationState.infectionProbability = clampInfectionProbability(probability)
      dashboard.simulation.setInfectionProbability(simulationState.infectionProbability)
      restartSimulation()
    }

    function setIncubationDays(days) {
      simulationState.incubationDays = clampIncubationDays(days)
      dashboard.simulation.setIncubationDays(simulationState.incubationDays)
      restartSimulation()
    }

    function setInfectionDays(days) {
      simulationState.infectionDays = clampInfectionDays(days)
      dashboard.simulation.setInfectionDays(simulationState.infectionDays)
      restartSimulation()
    }

    function setImmunityDays(days) {
      simulationState.immunityDays = clampImmunityDays(days)
      dashboard.simulation.setImmunityDays(simulationState.immunityDays)
      restartSimulation()
    }

    function setDayNightOverlayEnabled(enabled) {
      simulationState.dayNightOverlayEnabled = Boolean(enabled)
      dayNightOverlay.setEnabled(simulationState.dayNightOverlayEnabled)
      dashboard.simulation.setDayNightOverlayEnabled(simulationState.dayNightOverlayEnabled)
    }

    function setMapTextureEnabled(enabled) {
      dashboard.setMapTextureEnabled(enabled)
    }

    function setMapTextureOpacity(opacity) {
      dashboard.setMapTextureOpacity(opacity)
    }

    function setEntityRenderMode(mode) {
      dashboard.setEntityRenderMode(mode)
    }

    function setHeatmapRadius(radius) {
      dashboard.setHeatmapRadius(radius)
    }

    function destroy() {
      game.destroy()
      dashboard.destroy()
      cameraControls.destroy()
      entityContextMenu.destroy()
      npcHoverMenu.destroy()
      clearPixiContainer(entityLayer)
      app.destroy({ removeView: true }, { children: true })
      delete window.citySim
    }

    window.citySim = {
      camera,
      city,
      dashboard,
      npcHoverMenu,
      simulationClock,
      dayNightOverlay,
      pathSelection,
      gameLoop: game.loop,
      game,
      get npcSimulation() {
        return npcSimulation
      },
      get carSimulation() {
        return carSimulation
      },
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
      setInitialInfectiousCount,
      setInfectionDistance,
      setInfectionProbability,
      setIncubationDays,
      setInfectionDays,
      setImmunityDays,
      setDayNightOverlayEnabled,
      setMapTextureEnabled,
      setMapTextureOpacity,
      setEntityRenderMode,
      setHeatmapRadius,
      centerCameraOnCity: () => centerCameraOnCity(camera, world, city),
      followEntityWithCamera: (entity) => followEntityWithCamera(camera, world, entity),
      clearCameraFollow: () => clearCameraFollow(camera),
      destroy
    }

    setStatus('')
  } catch (error) {
    console.error(error)
    setStatus(`${error.message} If you opened this as a file, run npm run dev and load http://localhost:5173 instead.`, true)
  }
}
