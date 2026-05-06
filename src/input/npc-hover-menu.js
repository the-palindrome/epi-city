import { canvasPoint } from '../core/math.js'
import { findSelectableEntityAt } from './entity-path-selection.js'

const MENU_MARGIN_PX = 8
const CURSOR_OFFSET_PX = 14

export function installNpcHoverMenu({
  app,
  camera,
  city,
  getCarSimulation,
  getNpcSimulation
}) {
  const menu = document.createElement('div')
  let targetId = null
  let lastEvent = null
  let frameRequestId = null
  let destroyed = false

  menu.id = 'npc-hover-menu'
  menu.hidden = true
  menu.setAttribute('role', 'tooltip')
  document.body.appendChild(menu)

  function onMouseMove(event) {
    lastEvent = event

    if (frameRequestId === null) {
      frameRequestId = requestAnimationFrame(updateHover)
    }
  }

  function onMouseLeave() {
    lastEvent = null
    targetId = null
    hide()

    if (frameRequestId !== null) {
      cancelAnimationFrame(frameRequestId)
      frameRequestId = null
    }
  }

  function updateHover() {
    frameRequestId = null

    if (destroyed || !lastEvent) {
      return
    }

    const npcSimulation = getNpcSimulation()
    const point = canvasPoint(app.canvas, lastEvent)
    const worldPoint = {
      x: (point.x - camera.x) / camera.zoom,
      y: (point.y - camera.y) / camera.zoom
    }
    const hit = findSelectableEntityAt(
      worldPoint,
      city,
      npcSimulation?.npcs || [],
      getCarSimulation()?.cars || []
    )

    if (!hit || hit.kind !== 'npc' || !npcSimulation?.infection) {
      targetId = null
      hide()
      return
    }

    const status = npcSimulation.infection.getNpcStatus(hit.entity)

    if (!status) {
      targetId = null
      hide()
      return
    }

    if (targetId !== hit.entity.id) {
      targetId = hit.entity.id
    }

    renderStatus(hit.entity, status)
    showAt(lastEvent.clientX, lastEvent.clientY)
  }

  function renderStatus(npc, status) {
    menu.replaceChildren()
    menu.appendChild(createTitle(`NPC ${npc.id}`))
    menu.appendChild(createStatusRow('infection', status.infection, status.color))
    menu.appendChild(createRow('contagious', status.contagious ? 'yes' : 'no'))
    menu.appendChild(createRow('can be infected', status.canBeInfected ? 'yes' : 'no'))
    menu.appendChild(createRow('immune', status.immune ? 'yes' : 'no'))
    menu.appendChild(createRow(phaseTimerLabel(status), phaseTimerValue(status)))
  }

  function showAt(clientX, clientY) {
    menu.hidden = false
    menu.style.left = '0px'
    menu.style.top = '0px'

    const preferredLeft = clientX + CURSOR_OFFSET_PX
    const preferredTop = clientY + CURSOR_OFFSET_PX
    const maxLeft = Math.max(MENU_MARGIN_PX, window.innerWidth - menu.offsetWidth - MENU_MARGIN_PX)
    const maxTop = Math.max(MENU_MARGIN_PX, window.innerHeight - menu.offsetHeight - MENU_MARGIN_PX)

    menu.style.left = `${Math.min(Math.max(preferredLeft, MENU_MARGIN_PX), maxLeft)}px`
    menu.style.top = `${Math.min(Math.max(preferredTop, MENU_MARGIN_PX), maxTop)}px`
  }

  function hide() {
    menu.hidden = true
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    app.canvas.removeEventListener('mousemove', onMouseMove)
    app.canvas.removeEventListener('mouseleave', onMouseLeave)

    if (frameRequestId !== null) {
      cancelAnimationFrame(frameRequestId)
      frameRequestId = null
    }

    menu.remove()
  }

  app.canvas.addEventListener('mousemove', onMouseMove)
  app.canvas.addEventListener('mouseleave', onMouseLeave)

  return {
    element: menu,
    hide,
    destroy,
    get targetId() {
      return targetId
    }
  }
}

function createTitle(text) {
  const title = document.createElement('div')

  title.className = 'npc-hover-menu-title'
  title.textContent = text

  return title
}

function createStatusRow(labelText, valueText, color) {
  const row = createRow(labelText, '')
  const swatch = document.createElement('span')
  const text = document.createElement('span')
  const value = row.children[1]

  swatch.className = 'npc-hover-menu-swatch'
  swatch.style.backgroundColor = `#${color.toString(16).padStart(6, '0')}`
  text.textContent = valueText
  value.appendChild(swatch)
  value.appendChild(text)

  return row
}

function createRow(labelText, valueText) {
  const row = document.createElement('div')
  const label = document.createElement('span')
  const value = document.createElement('span')

  row.className = 'npc-hover-menu-row'
  label.className = 'npc-hover-menu-label'
  label.textContent = labelText
  value.className = 'npc-hover-menu-value'
  value.textContent = valueText
  row.appendChild(label)
  row.appendChild(value)

  return row
}

function phaseTimerLabel(status) {
  if (!status.nextState) {
    return 'phase timer'
  }

  return `${status.nextState} in`
}

function phaseTimerValue(status) {
  if (!status.nextState) {
    return 'none'
  }

  return formatDuration(status.remainingSeconds)
}

function formatDuration(seconds) {
  if (seconds >= 86400) {
    return `${formatNumber(seconds / 86400)} days`
  }

  if (seconds >= 3600) {
    return `${formatNumber(seconds / 3600)} hours`
  }

  if (seconds >= 60) {
    return `${formatNumber(seconds / 60)} min`
  }

  return `${Math.ceil(seconds)} sec`
}

function formatNumber(value) {
  return String(Number(value.toFixed(value >= 10 ? 0 : 1)))
}
