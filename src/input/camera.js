import { canvasPoint, clamp } from '../core/math.js'

export function createCamera() {
  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    zoom: 1,
    minZoom: 0.08,
    maxZoom: 8,
    worldWidth: 0,
    worldHeight: 0
  }
}

export function applyCameraToWorld(camera, world) {
  constrainCamera(camera)
  world.position.set(camera.x, camera.y)
  world.scale.set(camera.zoom)
}

export function centerCameraOnCity(camera, world, city) {
  const worldWidth = city.width * city.tileSize
  const worldHeight = city.height * city.tileSize

  camera.worldWidth = worldWidth
  camera.worldHeight = worldHeight
  refreshCameraZoomBounds(camera)
  camera.zoom = camera.minZoom
  camera.x = window.innerWidth / 2 - (worldWidth * camera.zoom) / 2
  camera.y = window.innerHeight / 2 - (worldHeight * camera.zoom) / 2
  applyCameraToWorld(camera, world)
}

export function installCameraControls(app, camera, applyCamera) {
  let isPanning = false
  let lastPointer = { x: 0, y: 0 }

  function onContextMenu(event) {
    event.preventDefault()
  }

  function onMouseDown(event) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    isPanning = true
    lastPointer = { x: event.clientX, y: event.clientY }
  }

  function onMouseMove(event) {
    if (!isPanning) {
      return
    }

    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y

    camera.x += dx
    camera.y += dy
    lastPointer = { x: event.clientX, y: event.clientY }
    applyCamera()
  }

  function onMouseUp(event) {
    if (event.button === 0) {
      isPanning = false
    }
  }

  function onWheel(event) {
    event.preventDefault()

    const pointer = canvasPoint(app.canvas, event)
    const worldX = (pointer.x - camera.x) / camera.zoom
    const worldY = (pointer.y - camera.y) / camera.zoom
    const zoomFactor = Math.exp(-event.deltaY * 0.001)

    refreshCameraZoomBounds(camera)

    const nextZoom = clamp(camera.zoom * zoomFactor, camera.minZoom, camera.maxZoom)

    camera.x = pointer.x - worldX * nextZoom
    camera.y = pointer.y - worldY * nextZoom
    camera.zoom = nextZoom
    applyCamera()
  }

  app.canvas.addEventListener('contextmenu', onContextMenu)
  app.canvas.addEventListener('mousedown', onMouseDown)
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('resize', applyCamera)

  return {
    destroy() {
      app.canvas.removeEventListener('contextmenu', onContextMenu)
      app.canvas.removeEventListener('mousedown', onMouseDown)
      app.canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('resize', applyCamera)
    }
  }
}

export function refreshCameraZoomBounds(camera) {
  if (!camera.worldWidth || !camera.worldHeight) {
    return
  }

  camera.minZoom = Math.max(
    window.innerWidth / camera.worldWidth,
    window.innerHeight / camera.worldHeight
  )

  if (camera.maxZoom < camera.minZoom) {
    camera.maxZoom = camera.minZoom
  }

  camera.zoom = clamp(camera.zoom, camera.minZoom, camera.maxZoom)
}

function constrainCamera(camera) {
  if (!camera.worldWidth || !camera.worldHeight) {
    return
  }

  refreshCameraZoomBounds(camera)

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const scaledWorldWidth = camera.worldWidth * camera.zoom
  const scaledWorldHeight = camera.worldHeight * camera.zoom

  camera.x = constrainAxis(camera.x, viewportWidth, scaledWorldWidth)
  camera.y = constrainAxis(camera.y, viewportHeight, scaledWorldHeight)
}

function constrainAxis(position, viewportSize, scaledWorldSize) {
  if (scaledWorldSize <= viewportSize) {
    return (viewportSize - scaledWorldSize) / 2
  }

  return clamp(position, viewportSize - scaledWorldSize, 0)
}
