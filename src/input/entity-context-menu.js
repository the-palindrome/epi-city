import { followEntityWithCamera } from './camera.js'
import { findSelectableEntityFromPointer } from './entity-path-selection.js'

const MENU_MARGIN_PX = 8

export function installEntityContextMenu({
  app,
  camera,
  city,
  world,
  getCarSimulation,
  getNpcSimulation,
  assumeEntityControl,
  showEntityRoute,
  hideEntityRoute,
  isEntityRouteVisible,
  requestRender
}) {
  const menu = document.createElement('div')
  const followButton = document.createElement('button')
  const assumeControlButton = document.createElement('button')
  const showRouteButton = document.createElement('button')
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

  assumeControlButton.type = 'button'
  assumeControlButton.className = 'entity-context-menu-option'
  assumeControlButton.textContent = 'assume control'
  assumeControlButton.setAttribute('role', 'menuitem')

  showRouteButton.type = 'button'
  showRouteButton.className = 'entity-context-menu-option'
  showRouteButton.textContent = 'show route'
  showRouteButton.setAttribute('role', 'menuitem')

  infectButton.type = 'button'
  infectButton.className = 'entity-context-menu-option'
  infectButton.textContent = 'infect'
  infectButton.setAttribute('role', 'menuitem')

  menu.appendChild(followButton)
  menu.appendChild(assumeControlButton)
  menu.appendChild(showRouteButton)
  menu.appendChild(infectButton)
  document.body.appendChild(menu)

  function onContextMenu(event) {
    event.preventDefault()

    const hit = findSelectableEntityFromPointer({
      app,
      camera,
      city,
      getNpcSimulation,
      getCarSimulation
    }, event)

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

  function onAssumeControlClick() {
    const selection = resolveTarget()

    hide()

    if (!selection || selection.kind !== 'npc' || typeof assumeEntityControl !== 'function') {
      return
    }

    assumeEntityControl(selection.kind, selection.entity.id)

    if (typeof requestRender === 'function') {
      requestRender()
    }
  }

  function onShowRouteClick() {
    const selection = resolveTarget()
    const routeVisible = isRouteVisibleForTarget()

    hide()

    if (!selection) {
      return
    }

    if (routeVisible) {
      if (typeof hideEntityRoute !== 'function') {
        return
      }

      hideEntityRoute(selection.kind, selection.entity.id)
    } else {
      if (typeof showEntityRoute !== 'function') {
        return
      }

      showEntityRoute(selection.kind, selection.entity.id)
    }

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
    assumeControlButton.hidden = !target || target.kind !== 'npc'
    showRouteButton.textContent = isRouteVisibleForTarget() ? 'hide route' : 'show route'
  }

  function isRouteVisibleForTarget() {
    return Boolean(target &&
      typeof isEntityRouteVisible === 'function' &&
      isEntityRouteVisible(target.kind, target.id))
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
    assumeControlButton.removeEventListener('click', onAssumeControlClick)
    showRouteButton.removeEventListener('click', onShowRouteClick)
    infectButton.removeEventListener('click', onInfectClick)
    document.removeEventListener('mousedown', onDocumentMouseDown)
    document.removeEventListener('keydown', onKeyDown)
    menu.remove()
  }

  app.canvas.addEventListener('contextmenu', onContextMenu)
  followButton.addEventListener('click', onFollowClick)
  assumeControlButton.addEventListener('click', onAssumeControlClick)
  showRouteButton.addEventListener('click', onShowRouteClick)
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
