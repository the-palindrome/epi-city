import { canvasPoint } from '../core/math.js'
import { followEntityWithCamera } from './camera.js'
import { findSelectableEntityAt } from './entity-path-selection.js'

const MENU_MARGIN_PX = 8

export function installEntityContextMenu({
  app,
  camera,
  city,
  world,
  getCarSimulation,
  getNpcSimulation,
  requestRender
}) {
  const menu = document.createElement('div')
  const followButton = document.createElement('button')
  const infectButton = document.createElement('button')
  let target = null
  let destroyed = false

  menu.id = 'entity-context-menu'
  menu.hidden = true
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Entity actions')

  followButton.type = 'button'
  followButton.className = 'entity-context-menu-option'
  followButton.textContent = 'follow'
  followButton.setAttribute('role', 'menuitem')

  infectButton.type = 'button'
  infectButton.className = 'entity-context-menu-option'
  infectButton.textContent = 'infect'
  infectButton.setAttribute('role', 'menuitem')

  menu.appendChild(followButton)
  menu.appendChild(infectButton)
  document.body.appendChild(menu)

  function onContextMenu(event) {
    event.preventDefault()

    const point = canvasPoint(app.canvas, event)
    const worldPoint = {
      x: (point.x - camera.x) / camera.zoom,
      y: (point.y - camera.y) / camera.zoom
    }
    const hit = findSelectableEntityAt(worldPoint, city, getNpcSimulation()?.npcs || [], getCarSimulation()?.cars || [])

    if (!hit) {
      hide()
      return
    }

    target = { kind: hit.kind, id: hit.entity.id }
    updateMenuActions()
    showAt(event.clientX, event.clientY)
  }

  function onFollowClick() {
    const selection = resolveTarget()

    hide()

    if (!selection) {
      return
    }

    if (followEntityWithCamera(camera, world, selection.entity) && typeof requestRender === 'function') {
      requestRender()
    }
  }

  function onInfectClick() {
    const selection = resolveTarget()
    const npcSimulation = getNpcSimulation()

    hide()

    if (!selection || selection.kind !== 'npc' || !npcSimulation?.infection) {
      return
    }

    npcSimulation.infection.setNpcState(selection.entity, 'infectious')

    if (typeof requestRender === 'function') {
      requestRender()
    }
  }

  function onDocumentMouseDown(event) {
    if (!menu.hidden && !menu.contains(event.target)) {
      hide()
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      hide()
    }
  }

  function showAt(clientX, clientY) {
    menu.hidden = false
    menu.style.left = '0px'
    menu.style.top = '0px'

    const maxLeft = Math.max(MENU_MARGIN_PX, window.innerWidth - menu.offsetWidth - MENU_MARGIN_PX)
    const maxTop = Math.max(MENU_MARGIN_PX, window.innerHeight - menu.offsetHeight - MENU_MARGIN_PX)

    menu.style.left = `${Math.min(Math.max(clientX, MENU_MARGIN_PX), maxLeft)}px`
    menu.style.top = `${Math.min(Math.max(clientY, MENU_MARGIN_PX), maxTop)}px`
    followButton.focus({ preventScroll: true })
  }

  function hide() {
    target = null
    menu.hidden = true
  }

  function updateMenuActions() {
    infectButton.hidden = !target || target.kind !== 'npc'
  }

  function resolveTarget() {
    if (!target) {
      return null
    }

    const entities = target.kind === 'car'
      ? getCarSimulation()?.cars || []
      : getNpcSimulation()?.npcs || []
    const entity = entities.find((candidate) => candidate.id === target.id)

    return entity ? { kind: target.kind, entity } : null
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    app.canvas.removeEventListener('contextmenu', onContextMenu)
    followButton.removeEventListener('click', onFollowClick)
    infectButton.removeEventListener('click', onInfectClick)
    document.removeEventListener('mousedown', onDocumentMouseDown)
    document.removeEventListener('keydown', onKeyDown)
    menu.remove()
  }

  app.canvas.addEventListener('contextmenu', onContextMenu)
  followButton.addEventListener('click', onFollowClick)
  infectButton.addEventListener('click', onInfectClick)
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onKeyDown)

  return {
    element: menu,
    hide,
    destroy,
    get target() {
      return target ? { ...target } : null
    }
  }
}
