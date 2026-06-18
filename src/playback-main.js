import {
  easingValue,
  getScriptDuration,
  normalizeEpiScript
} from './scripting/epi-script.js'
import {
  applySimulationSnapshot,
  createSimulationSnapshot,
  getRecordingDuration,
  setEntityPosition
} from './playback/simulation-snapshot.js'
import {
  createReplayScript,
  createSimulationRecordingFile,
  normalizeSimulationRecordingFile
} from './playback/simulation-recording.js'

const DEFAULT_SCRIPT = Object.freeze({
  simulation: {
    durationHours: 12,
    sampleInterval: 120,
    step: 2,
    parameters: {
      seedEnabled: true,
      seed: 'epi-city-video',
      npcCount: 700,
      carCount: 120,
      initialInfectiousCount: 8,
      dayNightOverlayEnabled: true,
      entityRenderMode: 'sprite'
    }
  },
  render: {
    duration: 24
  },
  script: [
    { at: 0, action: 'playback', from: 0, to: 43200, duration: 24 },
    { at: 0, action: 'setCamera', zoom: 0.16 },
    { at: 3, action: 'moveCamera', delta: { x: -520, y: -240, zoom: 0.12 }, duration: 7, easing: 'ease-in-out' },
    { at: 11, action: 'call', method: 'setEntityRenderMode', args: ['geometric'] },
    { at: 12, action: 'moveCamera', delta: { x: 340, y: 420, zoom: 0.08 }, duration: 8, easing: 'smooth' },
    { at: 20, action: 'call', method: 'setEntityRenderMode', args: ['sprite'] }
  ]
})

const PARAMETER_SETTERS = Object.freeze({
  seedEnabled: 'setSeedEnabled',
  seed: 'setSeed',
  speed: 'setSpeed',
  npcCount: 'setNpcCount',
  carCount: 'setCarCount',
  initialInfectiousCount: 'setInitialInfectiousCount',
  inoculatedPercent: 'setInoculatedPercent',
  infectionDistance: 'setInfectionDistance',
  infectionProbability: 'setInfectionProbability',
  incubationDays: 'setIncubationDays',
  infectionDays: 'setInfectionDays',
  immunityDays: 'setImmunityDays',
  dayNightOverlayEnabled: 'setDayNightOverlayEnabled',
  mapTextureEnabled: 'setMapTextureEnabled',
  mapTextureOpacity: 'setMapTextureOpacity',
  entityRenderMode: 'setEntityRenderMode',
  infectionRadiusVisible: 'setInfectionRadiusVisible',
  infectionEdgesVisible: 'setInfectionEdgesVisible',
  contactEdgesVisible: 'setContactEdgesVisible',
  pathTrailsVisible: 'setPathTrailsVisible',
  pathTrailLength: 'setPathTrailLength',
  heatmapRadius: 'setHeatmapRadius'
})

const METHOD_PATH_DENYLIST = new Set(['__proto__', 'prototype', 'constructor', 'destroy'])
const GENERATION_YIELD_INTERVAL = 180
const API_READY_TIMEOUT_MS = 240000
const FRAME_SOURCE = new URL('./index.html?embed=1&playback=1&render=1', window.location.href)

const elements = {
  frame: document.getElementById('playback-frame'),
  loadDefault: document.getElementById('playback-load-default'),
  file: document.getElementById('playback-file'),
  toggle: document.getElementById('playback-toggle'),
  scrubber: document.getElementById('playback-scrubber'),
  time: document.getElementById('playback-time'),
  status: document.getElementById('playback-status')
}

let citySim = null
let activeScript = null
let activeRecording = null
let currentRenderTime = 0
let animationFrameId = null
let lastAnimationMs = null
let playing = false
let busy = false

elements.frame.src = FRAME_SOURCE.href
installUi()
installVideoApi()
boot()

async function boot() {
  try {
    citySim = await waitForCitySim(elements.frame)
    setStatus('Ready')

    const searchParams = new URLSearchParams(window.location.search)
    const scriptUrl = searchParams.get('script')
    const recordingUrl = searchParams.get('recording')

    if (recordingUrl) {
      await loadRecordingFromUrl(recordingUrl, scriptUrl)
    } else if (scriptUrl) {
      await runScriptFromUrl(scriptUrl)
    }
  } catch (error) {
    setStatus(formatError(error), true)
    throw error
  }
}

function installVideoApi() {
  window.epiCityVideo = {
    runScript,
    loadRecording,
    seek,
    captureFrame,
    getDuration() {
      return activeScript ? getScriptDuration(activeScript) : 0
    },
    getRecording() {
      return activeRecording
    },
    getRecordingBundle() {
      return getRecordingBundle()
    }
  }
}

function installUi() {
  elements.loadDefault.addEventListener('click', () => {
    runScript(DEFAULT_SCRIPT).catch((error) => setStatus(formatError(error), true))
  })

  elements.file.addEventListener('change', async () => {
    const file = elements.file.files?.[0]

    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const payload = JSON.parse(text)

      if (isRecordingPayload(payload)) {
        await loadRecording(payload)
      } else {
        await runScript(payload)
      }
    } catch (error) {
      setStatus(formatError(error), true)
    }
  })

  elements.toggle.addEventListener('click', () => {
    setPlaying(!playing)
  })

  elements.scrubber.addEventListener('input', () => {
    setPlaying(false)
    seek(Number(elements.scrubber.value)).catch((error) => setStatus(formatError(error), true))
  })
}

async function runScriptFromUrl(scriptUrl) {
  setStatus(`Loading ${scriptUrl}...`)
  return runScript(await fetchJson(scriptUrl))
}

async function fetchJson(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Unable to load ${url}: ${response.status}`)
  }

  return response.json()
}

function isRecordingPayload(payload) {
  return Boolean(payload?.recording || payload?.format === 'epi-city-simulation-recording')
}

async function loadRecordingFromUrl(recordingUrl, scriptUrl = null) {
  setStatus(`Loading ${recordingUrl}...`)
  const recordingPayload = await fetchJson(recordingUrl)
  const scriptPayload = scriptUrl ? await fetchJson(scriptUrl) : null

  return loadRecording(recordingPayload, scriptPayload)
}

async function runScript(scriptInput) {
  if (!citySim) {
    citySim = await waitForCitySim(elements.frame)
  }

  setBusy(true)
  setPlaying(false)
  document.body.classList.toggle('video-render-mode', Boolean(new URLSearchParams(window.location.search).has('renderUiHidden')))

  try {
    const script = normalizeEpiScript(scriptInput)

    setStatus('Generating simulation...')
    activeRecording = await generateSimulationRecording(citySim, script, {
      onProgress: (progress) => {
        setStatus(`Generating ${Math.round(progress * 100)}%`)
      }
    })
    script.cameraStart = script.cameraStart || citySim.getCameraState?.() || null
    activeScript = script
    currentRenderTime = 0
    configureScrubber(getScriptDuration(activeScript))
    await seek(0)
    setStatus(`Ready: ${activeRecording.snapshots.length} snapshots`)

    return {
      duration: getScriptDuration(activeScript),
      actionCount: activeScript.actions.length,
      recordingDuration: getRecordingDuration(activeRecording),
      snapshotCount: activeRecording.snapshots.length
    }
  } finally {
    setBusy(false)
  }
}

async function loadRecording(recordingInput, scriptInput = null) {
  if (!citySim) {
    citySim = await waitForCitySim(elements.frame)
  }

  setBusy(true)
  setPlaying(false)
  document.body.classList.toggle('video-render-mode', Boolean(new URLSearchParams(window.location.search).has('renderUiHidden')))

  try {
    setStatus('Loading recording...')
    const recordingFile = normalizeSimulationRecordingFile(recordingInput)
    const script = createReplayScript(recordingFile, scriptInput)
    const recording = recordingFile.recording

    prepareRuntimeForRecording(citySim, script, recording)
    assertRuntimeMatchesRecording(citySim, recording)
    activeRecording = recording
    activeScript = script
    currentRenderTime = 0
    configureScrubber(getScriptDuration(activeScript))
    await seek(0)
    setStatus(`Ready: ${activeRecording.snapshots.length} recorded snapshots`)

    return summarizeActivePlayback({ recordingLoaded: true })
  } finally {
    setBusy(false)
  }
}

async function seek(renderSeconds) {
  if (!activeScript || !activeRecording) {
    throw new Error('No Epi City script loaded. Call epiCityVideo.runScript(script) first.')
  }

  currentRenderTime = clamp(Number(renderSeconds), 0, getScriptDuration(activeScript))
  const frameState = applyTimelineState(citySim, activeScript, activeRecording, currentRenderTime)

  citySim.render?.()
  updateUiTime()
  return frameState
}

async function captureFrame(options = {}) {
  if (!citySim) {
    citySim = await waitForCitySim(elements.frame)
  }

  return citySim.captureFrame?.(options)
}

async function generateSimulationRecording(runtime, script, options = {}) {
  runtime.game?.stop?.()
  applySimulationParameters(runtime, script.simulation.parameters)
  runtime.restart?.()
  runtime.game?.stop?.()

  const durationSeconds = script.simulation.durationSeconds
  const sampleIntervalSeconds = script.simulation.sampleIntervalSeconds
  const stepSeconds = script.simulation.stepSeconds
  const simRate = Math.max(1, Number(runtime.simulationClock?.getSimulationSecondsPerRealSecond?.()) || 60)
  const snapshots = []
  const actions = script.simulation.actions
  let actionIndex = 0
  let nextSampleSeconds = 0
  let stepCount = 0

  applyDueSimulationActions(runtime, actions, actionIndex, 0)
  while (actionIndex < actions.length && actions[actionIndex].at <= 0) {
    actionIndex += 1
  }

  snapshots.push(createSimulationSnapshot(runtime))
  nextSampleSeconds += sampleIntervalSeconds

  while (runtime.simulationClock.getElapsedSimulationSeconds() < durationSeconds) {
    const elapsedSeconds = runtime.simulationClock.getElapsedSimulationSeconds()
    const nextActionSeconds = actionIndex < actions.length ? actions[actionIndex].at : Infinity
    const nextBoundarySeconds = Math.min(durationSeconds, nextSampleSeconds, nextActionSeconds)
    const deltaSimulationSeconds = Math.min(
      stepSeconds,
      Math.max(0, nextBoundarySeconds - elapsedSeconds) || stepSeconds,
      durationSeconds - elapsedSeconds
    )
    const deltaGameSeconds = deltaSimulationSeconds / simRate

    runtime.game.updateSystems(deltaGameSeconds)

    const nextElapsedSeconds = runtime.simulationClock.getElapsedSimulationSeconds()

    while (actionIndex < actions.length && actions[actionIndex].at <= nextElapsedSeconds + 0.0001) {
      applySimulationAction(runtime, actions[actionIndex])
      actionIndex += 1
    }

    if (nextElapsedSeconds + 0.0001 >= nextSampleSeconds || nextElapsedSeconds >= durationSeconds) {
      snapshots.push(createSimulationSnapshot(runtime))
      nextSampleSeconds += sampleIntervalSeconds
    }

    stepCount += 1
    if (stepCount % GENERATION_YIELD_INTERVAL === 0) {
      options.onProgress?.(Math.min(1, nextElapsedSeconds / durationSeconds))
      await yieldToBrowser()
    }
  }

  return {
    durationSeconds,
    sampleIntervalSeconds,
    stepSeconds,
    parameters: { ...script.simulation.parameters },
    snapshots
  }
}

function prepareRuntimeForRecording(runtime, script, recording) {
  runtime.game?.stop?.()
  applySimulationParameters(runtime, {
    ...script.simulation.parameters,
    ...recording.parameters
  })
  runtime.restart?.()
  runtime.game?.stop?.()
}

function assertRuntimeMatchesRecording(runtime, recording) {
  const firstSnapshot = recording.snapshots[0]
  const npcs = Array.isArray(runtime?.npcs) ? runtime.npcs : []
  const cars = Array.isArray(runtime?.cars) ? runtime.cars : []

  assertEntityIdsMatch('NPC', npcs, firstSnapshot.npcs || [])
  assertEntityIdsMatch('car', cars, firstSnapshot.cars || [])
}

function assertEntityIdsMatch(label, runtimeEntities, snapshotEntities) {
  if (runtimeEntities.length !== snapshotEntities.length) {
    throw new Error(`Recording ${label} count ${snapshotEntities.length} does not match runtime count ${runtimeEntities.length}.`)
  }

  const runtimeIds = new Set(runtimeEntities.map((entity) => entity.id))

  for (const entity of snapshotEntities) {
    if (!runtimeIds.has(entity.id)) {
      throw new Error(`Recording references missing ${label} id ${entity.id}.`)
    }
  }
}

function getRecordingBundle() {
  if (!activeScript || !activeRecording) {
    return null
  }

  return createSimulationRecordingFile({
    script: activeScript,
    recording: activeRecording,
    summary: summarizeActivePlayback()
  })
}

function summarizeActivePlayback(extra = {}) {
  return {
    duration: activeScript ? getScriptDuration(activeScript) : 0,
    actionCount: activeScript?.actions?.length ?? 0,
    recordingDuration: activeRecording ? getRecordingDuration(activeRecording) : 0,
    snapshotCount: activeRecording?.snapshots?.length ?? 0,
    ...extra
  }
}

function applyDueSimulationActions(runtime, actions, startIndex, simulationSeconds) {
  for (let index = startIndex; index < actions.length && actions[index].at <= simulationSeconds; index += 1) {
    applySimulationAction(runtime, actions[index])
  }
}

function applySimulationAction(runtime, action) {
  switch (action.action) {
    case 'call':
      callRuntimeMethod(runtime, action.method, action.args || [])
      break
    case 'setNpcPosition':
    case 'setCarPosition':
      setEntityPosition(runtime, {
        ...action,
        kind: action.action === 'setCarPosition' ? 'car' : 'npc'
      })
      break
    default:
      break
  }
}

function applyTimelineState(runtime, script, recording, renderSeconds) {
  const recordingDuration = getRecordingDuration(recording)
  const simulationSeconds = resolvePlaybackSeconds(script, renderSeconds, recordingDuration)
  const snapshot = applySimulationSnapshot(runtime, recording, simulationSeconds)

  applyTimelineCalls(runtime, script.actions, renderSeconds)
  applyTimelineEntityActions(runtime, script.actions, renderSeconds)
  applyTimelineCamera(runtime, script, renderSeconds)

  return {
    renderSeconds,
    simulationSeconds,
    snapshotSeconds: snapshot?.simulationSeconds ?? null,
    camera: runtime.getCameraState?.() ?? null
  }
}

function resolvePlaybackSeconds(script, renderSeconds, recordingDuration) {
  const renderDuration = getScriptDuration(script)
  let resolved = renderDuration > 0
    ? (renderSeconds / renderDuration) * recordingDuration
    : 0

  for (const action of script.actions) {
    if (action.action !== 'playback' || action.at > renderSeconds) {
      continue
    }

    const from = finiteNumber(action.from ?? action.start ?? action.simulationStart, resolved)
    const to = finiteNumber(action.to ?? action.end ?? action.simulationEnd ?? action.simulationTime, from)
    const duration = Math.max(0, finiteNumber(action.duration, 0))

    if (duration <= 0 || renderSeconds >= action.at + duration) {
      resolved = to
    } else {
      const ratio = easingValue(action.easing || 'linear', (renderSeconds - action.at) / duration)
      resolved = from + (to - from) * ratio
    }
  }

  return clamp(resolved, 0, recordingDuration)
}

function applyTimelineCalls(runtime, actions, renderSeconds) {
  for (const action of actions) {
    if (action.action !== 'call' || action.at > renderSeconds) {
      continue
    }

    callRuntimeMethod(runtime, action.method, action.args || [])
  }
}

function applyTimelineEntityActions(runtime, actions, renderSeconds) {
  for (const action of actions) {
    if (!['setNpcPosition', 'moveNpc', 'setCarPosition', 'moveCar'].includes(action.action) || action.at > renderSeconds) {
      continue
    }

    const duration = Math.max(0, finiteNumber(action.duration, 0))
    const active = duration <= 0 || renderSeconds <= action.at + duration

    if (!active) {
      if (action.action.startsWith('move')) {
        setEntityPosition(runtime, timelineEntityAction(action), 1)
      }
      continue
    }

    const ratio = duration <= 0
      ? 1
      : easingValue(action.easing || 'smooth', (renderSeconds - action.at) / duration)

    setEntityPosition(runtime, timelineEntityAction(action), ratio)
  }
}

function timelineEntityAction(action) {
  const kind = action.action.endsWith('Car') ? 'car' : 'npc'

  return { ...action, kind }
}

function applyTimelineCamera(runtime, script, renderSeconds) {
  const baseCamera = script.cameraStart || runtime.getCameraState?.() || { x: 0, y: 0, zoom: 1 }
  let camera = { ...baseCamera }

  for (const action of script.actions) {
    if (!['setCamera', 'moveCamera', 'followEntity'].includes(action.action) || action.at > renderSeconds) {
      continue
    }

    if (action.action === 'setCamera') {
      camera = resolveCameraTarget(action, camera)
      continue
    }

    if (action.action === 'moveCamera') {
      const duration = Math.max(0, finiteNumber(action.duration, 0))
      const from = resolveCameraSource(action, camera)
      const to = resolveCameraTarget(action, from)

      if (duration <= 0 || renderSeconds >= action.at + duration) {
        camera = to
      } else {
        const ratio = easingValue(action.easing || 'smooth', (renderSeconds - action.at) / duration)
        camera = interpolateCamera(from, to, ratio)
      }
      continue
    }

    if (action.action === 'followEntity') {
      const duration = Math.max(0, finiteNumber(action.duration, 0))

      if (duration > 0 && renderSeconds > action.at + duration) {
        continue
      }

      const entityCamera = cameraForEntity(runtime, action, camera)

      if (entityCamera) {
        camera = entityCamera
      }
    }
  }

  runtime.setCameraState?.(camera, { render: false })
}

function resolveCameraSource(action, currentCamera) {
  const from = parseCameraState(action.from)

  return from ? mergeCamera(currentCamera, from) : { ...currentCamera }
}

function resolveCameraTarget(action, currentCamera) {
  const explicit = parseCameraState(action.to ?? action.camera ?? action.target)
  const merged = explicit ? mergeCamera(currentCamera, explicit) : mergeCamera(currentCamera, action)
  const delta = parseCameraState(action.delta ?? action.offset)

  if (!delta) {
    return merged
  }

  return {
    x: merged.x + finiteNumber(delta.x, 0),
    y: merged.y + finiteNumber(delta.y, 0),
    zoom: Math.max(0.0001, merged.zoom + finiteNumber(delta.zoom, 0))
  }
}

function cameraForEntity(runtime, action, currentCamera) {
  const kind = action.kind === 'car' || action.action === 'followCar' ? 'car' : 'npc'
  const id = Number(action.id ?? action.entityId ?? action.npcId ?? action.carId)
  const entities = kind === 'car' ? runtime.cars : runtime.npcs
  const entity = Array.isArray(entities) ? entities.find((candidate) => candidate.id === id) : null

  if (!entity?.position) {
    return null
  }

  const viewport = runtime.app?.renderer
    ? { width: runtime.app.renderer.width, height: runtime.app.renderer.height }
    : { width: window.innerWidth, height: window.innerHeight }
  const zoom = Math.max(0.0001, finiteNumber(action.zoom, currentCamera.zoom))

  return {
    x: viewport.width / 2 - entity.position.x * zoom,
    y: viewport.height / 2 - entity.position.y * zoom,
    zoom
  }
}

function parseCameraState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const camera = {}

  if ('x' in value) camera.x = Number(value.x)
  if ('y' in value) camera.y = Number(value.y)
  if ('zoom' in value) camera.zoom = Number(value.zoom)

  return Object.keys(camera).some((key) => Number.isFinite(camera[key])) ? camera : null
}

function mergeCamera(currentCamera, nextCamera) {
  return {
    x: finiteNumber(nextCamera.x, currentCamera.x),
    y: finiteNumber(nextCamera.y, currentCamera.y),
    zoom: Math.max(0.0001, finiteNumber(nextCamera.zoom, currentCamera.zoom))
  }
}

function interpolateCamera(from, to, ratio) {
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    zoom: from.zoom + (to.zoom - from.zoom) * ratio
  }
}

function applySimulationParameters(runtime, parameters = {}) {
  for (const [key, value] of Object.entries(parameters || {})) {
    const setterName = PARAMETER_SETTERS[key]

    if (!setterName || typeof runtime[setterName] !== 'function') {
      continue
    }

    runtime[setterName](value)
  }
}

function callRuntimeMethod(runtime, methodPath, args = []) {
  if (typeof methodPath !== 'string' || methodPath.trim().length === 0) {
    throw new Error('Script call action requires a method string.')
  }

  const parts = methodPath.split('.').map((part) => part.trim()).filter(Boolean)

  if (parts.length === 0 || parts.some((part) => METHOD_PATH_DENYLIST.has(part))) {
    throw new Error(`Script call method is not allowed: ${methodPath}`)
  }

  let context = runtime

  for (let index = 0; index < parts.length - 1; index += 1) {
    context = context?.[parts[index]]
  }

  const method = context?.[parts[parts.length - 1]]

  if (typeof method !== 'function') {
    throw new Error(`Script call target is not a function: ${methodPath}`)
  }

  return method.apply(context, Array.isArray(args) ? args : [args])
}

function setPlaying(nextPlaying) {
  playing = Boolean(nextPlaying && activeScript && activeRecording && !busy)
  elements.toggle.textContent = playing ? 'Pause' : 'Play'

  if (playing) {
    lastAnimationMs = null
    animationFrameId = requestAnimationFrame(tickPlayback)
  } else if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
}

function tickPlayback(timestamp) {
  if (!playing) {
    return
  }

  if (lastAnimationMs === null) {
    lastAnimationMs = timestamp
  }

  const deltaSeconds = Math.max(0, (timestamp - lastAnimationMs) / 1000)
  lastAnimationMs = timestamp

  seek(Math.min(getScriptDuration(activeScript), currentRenderTime + deltaSeconds)).catch((error) => {
    setPlaying(false)
    setStatus(formatError(error), true)
  })

  if (currentRenderTime >= getScriptDuration(activeScript)) {
    setPlaying(false)
    return
  }

  animationFrameId = requestAnimationFrame(tickPlayback)
}

function configureScrubber(duration) {
  elements.toggle.disabled = false
  elements.scrubber.disabled = false
  elements.scrubber.min = '0'
  elements.scrubber.max = String(Math.max(0, duration))
  elements.scrubber.step = '0.001'
}

function updateUiTime() {
  elements.scrubber.value = String(currentRenderTime)
  elements.time.textContent = `${formatSeconds(currentRenderTime)} / ${formatSeconds(getScriptDuration(activeScript))}`
}

function setBusy(nextBusy) {
  busy = Boolean(nextBusy)
  elements.toggle.disabled = busy || !activeScript
  elements.scrubber.disabled = busy || !activeScript
  elements.file.disabled = busy
  elements.loadDefault.disabled = busy
}

function setStatus(message, isError = false) {
  elements.status.textContent = message
  elements.status.style.color = isError ? '#8f2020' : '#526044'
}

async function waitForCitySim(frame) {
  const startedAt = performance.now()

  while (performance.now() - startedAt < API_READY_TIMEOUT_MS) {
    const runtime = frame.contentWindow?.citySim

    if (runtime?.game && runtime?.simulationClock && runtime?.captureFrame) {
      return runtime
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('Timed out waiting for Epi City runtime.')
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function formatError(error) {
  return error?.message || String(error)
}

function finiteNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return min
  }

  return Math.min(Math.max(number, min), max)
}
