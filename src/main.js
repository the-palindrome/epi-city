import * as PIXI from 'pixi.js'
import {
  CITY_MAP_PATHS,
  DEFAULT_CITY_MAP,
  NPC_CONFIG,
  TILE_NAMES,
  TILE_TYPES
} from './core/constants.js'
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
  validateCityMap,
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
    const defaultMapPaths = CITY_MAP_PATHS[DEFAULT_CITY_MAP]
    const mapData = await loadCityMap(defaultMapPaths.tileLayout, defaultMapPaths.textureLayout)
    const city = compileCityMap(mapData)
    let textureSet = await loadTextureSet(city.textureSetName)

    validateCityTextureBindings(city, textureSet)
    renderCity(city, mapLayer, textureSet)
    centerCameraOnCity(camera, world, city)

    const cameraControls = installCameraControls(app, camera, applyCamera)
    const dashboard = installDebugDashboard(city, overlayLayer)
    const npcSimulation = createNpcSimulation(city, actorLayer, NPC_CONFIG)
    const game = new Game(app)

    game.addSystem(npcSimulation)
    game.start()

    async function setTextureSet(name) {
      const nextTextureSet = await loadTextureSet(name)

      validateCityTextureBindings(city, nextTextureSet)
      textureSet = nextTextureSet
      city.textureSetName = name
      renderCity(city, mapLayer, textureSet)
      window.citySim.textureSet = textureSet
      game.render()
    }

    function rerenderCity() {
      renderCity(city, mapLayer, textureSet)
      game.render()
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
      app,
      camera,
      world,
      layers: {
        map: mapLayer,
        overlays: overlayLayer,
        actors: actorLayer
      },
      tileTypes: TILE_TYPES,
      tileNames: TILE_NAMES,
      applyCamera,
      city,
      mapData,
      textureSet,
      dashboard,
      game,
      gameLoop: game.loop,
      npcSimulation,
      npcs: npcSimulation.npcs,
      loadCityMap,
      loadTextureSet,
      setTextureSet,
      validateCityMap,
      compileCityMap,
      renderCity: rerenderCity,
      centerCameraOnCity: () => centerCameraOnCity(camera, world, city),
      destroy
    }

    setStatus('')
  } catch (error) {
    console.error(error)
    setStatus(`${error.message} If you opened this as a file, run npm run dev and load http://localhost:5173 instead.`, true)
  }
}
