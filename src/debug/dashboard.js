import * as PIXI from 'pixi.js'
import {
  DASHBOARD_OVERLAYS,
  DEBUG_OVERLAY_COLORS,
  TILE_TYPE_OVERLAY_COLORS
} from '../core/constants.js'
import { fillRect } from '../render/pixi-rendering.js'

export function installDebugDashboard(city, entityLayer, simulationControls = {}) {
  const dashboard = document.getElementById('debug-dashboard')
  const overlayState = Object.fromEntries(DASHBOARD_OVERLAYS.map((overlay) => [overlay.id, false]))
  const controls = new Map()
  const layers = new Map()
  const simulation = createSimulationControls(simulationControls)
  const overlaySection = createDashboardSection('Overlays')

  dashboard.innerHTML = ''
  dashboard.appendChild(createDashboardTitle())
  dashboard.appendChild(simulation.element)

  for (const overlay of DASHBOARD_OVERLAYS) {
    const control = createOverlayToggle(overlay)

    controls.set(overlay.id, control.input)
    overlaySection.appendChild(control.label)

    control.input.addEventListener('change', () => {
      setOverlay(overlay.id, control.input.checked)
    })
  }

  dashboard.appendChild(overlaySection)

  function render() {
    simulation.render()

    for (const overlay of DASHBOARD_OVERLAYS) {
      const enabled = overlayState[overlay.id]
      const layer = enabled ? ensureOverlayLayer(overlay) : layers.get(overlay.id)

      if (layer) {
        setOverlayLayerVisible(layer, enabled)
      }
    }
  }

  function ensureOverlayLayer(overlay) {
    if (!layers.has(overlay.id)) {
      const layer = createOverlayLayer(entityLayer)

      if (overlay.kind === 'tileType') {
        drawTileTypeOverlay(city, layer)
      } else {
        drawBehaviorOverlay(city, layer, city[overlay.layer])
      }

      layers.set(overlay.id, layer)
    }

    return layers.get(overlay.id)
  }

  function setOverlay(id, enabled) {
    if (!Object.prototype.hasOwnProperty.call(overlayState, id)) {
      throw new Error(`Unknown debug overlay "${id}".`)
    }

    overlayState[id] = Boolean(enabled)
    controls.get(id).checked = overlayState[id]
    render()
  }

  function toggleDashboard(force) {
    const shouldHide = typeof force === 'boolean' ? !force : !dashboard.classList.contains('hidden')
    dashboard.classList.toggle('hidden', shouldHide)
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''

    if (key === 'd' && !isEditableTarget(event.target)) {
      event.preventDefault()
      toggleDashboard()
      return
    }

    if (!isSpaceHotkey(event) || isInteractiveTarget(event.target)) {
      return
    }

    event.preventDefault()
    simulation.togglePlayback()
  }

  document.addEventListener('keydown', onKeyDown)

  return {
    element: dashboard,
    overlays: overlayState,
    simulation,
    setOverlay,
    toggle: toggleDashboard,
    render,
    destroy() {
      document.removeEventListener('keydown', onKeyDown)
      for (const layer of layers.values()) {
        destroyOverlayLayer(layer)
      }

      dashboard.innerHTML = ''
      layers.clear()
    }
  }
}

function createDashboardTitle() {
  const title = document.createElement('div')
  const shortcut = document.createElement('span')

  title.className = 'dashboard-title'
  title.textContent = 'Dashboard'
  shortcut.className = 'dashboard-shortcut'
  shortcut.textContent = 'D'
  title.appendChild(shortcut)

  return title
}

function createDashboardSection(titleText) {
  const section = document.createElement('div')
  const title = document.createElement('div')

  section.className = 'dashboard-section'
  title.className = 'dashboard-section-title'
  title.textContent = titleText
  section.appendChild(title)

  return section
}

function createSimulationControls(options) {
  const state = {
    paused: Boolean(options.paused),
    seedEnabled: Boolean(options.seedEnabled),
    seed: options.seed || '',
    speed: options.speed || 1,
    npcCount: normalizeNpcCount(options.npcCount ?? 1000, options.npcCountRange),
    carCount: normalizeCarCount(options.carCount ?? 500, options.carCountRange),
    initialInfectiousCount: normalizeInitialInfectiousCount(options.initialInfectiousCount ?? 4, options.initialInfectiousCountRange),
    infectionDistance: normalizeInfectionDistance(options.infectionDistance ?? 48, options.infectionDistanceRange),
    infectionProbability: normalizeInfectionProbability(options.infectionProbability ?? 0.03, options.infectionProbabilityRange),
    incubationDays: normalizeIncubationDays(options.incubationDays ?? 5, options.incubationDaysRange),
    infectionDays: normalizeInfectionDays(options.infectionDays ?? 7, options.infectionDaysRange),
    immunityDays: normalizeImmunityDays(options.immunityDays ?? 90, options.immunityDaysRange),
    dayNightOverlayEnabled: options.dayNightOverlayEnabled !== false
  }
  const callbacks = {
    onPlay: options.onPlay || noop,
    onPause: options.onPause || noop,
    onRestart: options.onRestart || noop,
    onSeedEnabledChange: options.onSeedEnabledChange || noop,
    onSeedChange: options.onSeedChange || noop,
    onSpeedChange: options.onSpeedChange || noop,
    onNpcCountChange: options.onNpcCountChange || noop,
    onCarCountChange: options.onCarCountChange || noop,
    onInitialInfectiousCountChange: options.onInitialInfectiousCountChange || noop,
    onInfectionDistanceChange: options.onInfectionDistanceChange || noop,
    onInfectionProbabilityChange: options.onInfectionProbabilityChange || noop,
    onIncubationDaysChange: options.onIncubationDaysChange || noop,
    onInfectionDaysChange: options.onInfectionDaysChange || noop,
    onImmunityDaysChange: options.onImmunityDaysChange || noop,
    onDayNightOverlayChange: options.onDayNightOverlayChange || noop
  }
  const speedRange = normalizeSpeedRange(options.speedRange)
  const npcCountRange = normalizeNpcCountRange(options.npcCountRange)
  const carCountRange = normalizeCarCountRange(options.carCountRange)
  const initialInfectiousCountRange = normalizeInitialInfectiousCountRange(options.initialInfectiousCountRange)
  const infectionDistanceRange = normalizeInfectionDistanceRange(options.infectionDistanceRange)
  const infectionProbabilityRange = normalizeInfectionProbabilityRange(options.infectionProbabilityRange)
  const incubationDaysRange = normalizeIncubationDaysRange(options.incubationDaysRange)
  const infectionDaysRange = normalizeInfectionDaysRange(options.infectionDaysRange)
  const immunityDaysRange = normalizeImmunityDaysRange(options.immunityDaysRange)
  const section = createDashboardSection('Simulation')
  const actions = document.createElement('div')
  const playButton = createDashboardButton('Play', 'play')
  const pauseButton = createDashboardButton('Pause', 'pause')
  const restartButton = createDashboardButton('Restart', 'restart')
  const clockField = createClockField()
  const seedToggle = createSeedToggle(state.seedEnabled)
  const seedField = createSeedField(state.seed)
  const speedField = createSpeedField(state.speed, speedRange)
  const npcCountField = createNpcCountField(state.npcCount, npcCountRange)
  const carCountField = createCarCountField(state.carCount, carCountRange)
  const dayNightToggle = createDayNightToggle(state.dayNightOverlayEnabled)
  const infectionTitle = createDashboardSubsectionTitle('Infection')
  const infectionStatsField = createInfectionStatsField()
  const initialInfectiousCountField = createInitialInfectiousCountField(state.initialInfectiousCount, initialInfectiousCountRange)
  const infectionDistanceField = createInfectionDistanceField(state.infectionDistance, infectionDistanceRange)
  const infectionProbabilityField = createInfectionProbabilityField(state.infectionProbability, infectionProbabilityRange)
  const incubationDaysField = createIncubationDaysField(state.incubationDays, incubationDaysRange)
  const infectionDaysField = createInfectionDaysField(state.infectionDays, infectionDaysRange)
  const immunityDaysField = createImmunityDaysField(state.immunityDays, immunityDaysRange)

  actions.className = 'dashboard-actions'
  actions.appendChild(playButton)
  actions.appendChild(pauseButton)
  actions.appendChild(restartButton)
  section.appendChild(actions)
  section.appendChild(clockField.label)
  section.appendChild(seedToggle.label)
  section.appendChild(seedField.label)
  section.appendChild(speedField.label)
  section.appendChild(npcCountField.label)
  section.appendChild(carCountField.label)
  section.appendChild(dayNightToggle.label)
  section.appendChild(infectionTitle)
  section.appendChild(infectionStatsField.label)
  section.appendChild(initialInfectiousCountField.label)
  section.appendChild(infectionDistanceField.label)
  section.appendChild(infectionProbabilityField.label)
  section.appendChild(incubationDaysField.label)
  section.appendChild(infectionDaysField.label)
  section.appendChild(immunityDaysField.label)

  playButton.addEventListener('click', play)

  pauseButton.addEventListener('click', pause)

  restartButton.addEventListener('click', () => {
    callbacks.onRestart()
  })

  seedToggle.input.addEventListener('change', () => {
    setSeedEnabled(seedToggle.input.checked)
    callbacks.onSeedEnabledChange(state.seedEnabled)
  })

  seedField.input.addEventListener('input', () => {
    state.seed = seedField.input.value
    callbacks.onSeedChange(state.seed)
  })

  speedField.input.addEventListener('input', () => {
    const speed = Number(speedField.input.value)

    setSpeed(speed)
    callbacks.onSpeedChange(state.speed)
  })

  npcCountField.slider.addEventListener('input', () => {
    setNpcCount(npcCountField.slider.value)
  })

  npcCountField.slider.addEventListener('change', () => {
    callbacks.onNpcCountChange(state.npcCount)
  })

  npcCountField.input.addEventListener('change', () => {
    setNpcCount(npcCountField.input.value)
    callbacks.onNpcCountChange(state.npcCount)
  })

  carCountField.slider.addEventListener('input', () => {
    setCarCount(carCountField.slider.value)
  })

  carCountField.slider.addEventListener('change', () => {
    callbacks.onCarCountChange(state.carCount)
  })

  carCountField.input.addEventListener('change', () => {
    setCarCount(carCountField.input.value)
    callbacks.onCarCountChange(state.carCount)
  })

  dayNightToggle.input.addEventListener('change', () => {
    setDayNightOverlayEnabled(dayNightToggle.input.checked)
    callbacks.onDayNightOverlayChange(state.dayNightOverlayEnabled)
  })

  initialInfectiousCountField.input.addEventListener('change', () => {
    setInitialInfectiousCount(initialInfectiousCountField.input.value)
    callbacks.onInitialInfectiousCountChange(state.initialInfectiousCount)
  })

  infectionDistanceField.input.addEventListener('change', () => {
    setInfectionDistance(infectionDistanceField.input.value)
    callbacks.onInfectionDistanceChange(state.infectionDistance)
  })

  infectionProbabilityField.input.addEventListener('change', () => {
    setInfectionProbability(infectionProbabilityField.input.value)
    callbacks.onInfectionProbabilityChange(state.infectionProbability)
  })

  incubationDaysField.input.addEventListener('change', () => {
    setIncubationDays(incubationDaysField.input.value)
    callbacks.onIncubationDaysChange(state.incubationDays)
  })

  infectionDaysField.input.addEventListener('change', () => {
    setInfectionDays(infectionDaysField.input.value)
    callbacks.onInfectionDaysChange(state.infectionDays)
  })

  immunityDaysField.input.addEventListener('change', () => {
    setImmunityDays(immunityDaysField.input.value)
    callbacks.onImmunityDaysChange(state.immunityDays)
  })

  function play() {
    callbacks.onPlay()
    setPaused(false)
  }

  function pause() {
    callbacks.onPause()
    setPaused(true)
  }

  function togglePlayback() {
    if (state.paused) {
      play()
    } else {
      pause()
    }
  }

  function setPaused(paused) {
    state.paused = Boolean(paused)
    playButton.disabled = !state.paused
    pauseButton.disabled = state.paused
  }

  function setSeedEnabled(enabled) {
    state.seedEnabled = Boolean(enabled)
    seedToggle.input.checked = state.seedEnabled
  }

  function setSeed(seed) {
    state.seed = seed
    seedField.input.value = state.seed
  }

  function setSpeed(speed) {
    state.speed = clampSpeed(Number(speed), speedRange)
    speedField.input.value = String(state.speed)
    speedField.value.textContent = formatSpeed(state.speed)
  }

  function setNpcCount(count) {
    state.npcCount = normalizeNpcCount(count, npcCountRange)
    npcCountField.slider.value = String(state.npcCount)
    npcCountField.input.value = String(state.npcCount)
  }

  function setCarCount(count) {
    state.carCount = normalizeCarCount(count, carCountRange)
    carCountField.slider.value = String(state.carCount)
    carCountField.input.value = String(state.carCount)
  }

  function setDayNightOverlayEnabled(enabled) {
    state.dayNightOverlayEnabled = Boolean(enabled)
    dayNightToggle.input.checked = state.dayNightOverlayEnabled
  }

  function setInitialInfectiousCount(count) {
    state.initialInfectiousCount = normalizeInitialInfectiousCount(count, initialInfectiousCountRange)
    initialInfectiousCountField.input.value = String(state.initialInfectiousCount)
  }

  function setInfectionDistance(distance) {
    state.infectionDistance = normalizeInfectionDistance(distance, infectionDistanceRange)
    infectionDistanceField.input.value = formatNumberInput(state.infectionDistance)
  }

  function setInfectionProbability(probability) {
    state.infectionProbability = normalizeInfectionProbability(probability, infectionProbabilityRange)
    infectionProbabilityField.input.value = formatNumberInput(state.infectionProbability)
  }

  function setIncubationDays(days) {
    state.incubationDays = normalizeIncubationDays(days, incubationDaysRange)
    incubationDaysField.input.value = formatNumberInput(state.incubationDays)
  }

  function setInfectionDays(days) {
    state.infectionDays = normalizeInfectionDays(days, infectionDaysRange)
    infectionDaysField.input.value = formatNumberInput(state.infectionDays)
  }

  function setImmunityDays(days) {
    state.immunityDays = normalizeImmunityDays(days, immunityDaysRange)
    immunityDaysField.input.value = formatNumberInput(state.immunityDays)
  }

  function render() {
    clockField.value.textContent = formatClockDisplay(options.clock)
    infectionStatsField.value.textContent = formatInfectionStats(
      typeof options.getInfectionStats === 'function' ? options.getInfectionStats() : null
    )
  }

  setPaused(state.paused)
  setSeedEnabled(state.seedEnabled)
  setSeed(state.seed)
  setSpeed(state.speed)
  setNpcCount(state.npcCount)
  setCarCount(state.carCount)
  setDayNightOverlayEnabled(state.dayNightOverlayEnabled)
  setInitialInfectiousCount(state.initialInfectiousCount)
  setInfectionDistance(state.infectionDistance)
  setInfectionProbability(state.infectionProbability)
  setIncubationDays(state.incubationDays)
  setInfectionDays(state.infectionDays)
  setImmunityDays(state.immunityDays)
  render()

  return {
    element: section,
    state,
    render,
    setPaused,
    setSeedEnabled,
    setSeed,
    setSpeed,
    setNpcCount,
    setCarCount,
    setDayNightOverlayEnabled,
    setInitialInfectiousCount,
    setInfectionDistance,
    setInfectionProbability,
    setIncubationDays,
    setInfectionDays,
    setImmunityDays,
    togglePlayback
  }
}

function createDashboardButton(label, action) {
  const button = document.createElement('button')

  button.className = 'dashboard-button'
  button.type = 'button'
  button.dataset.simulationAction = action
  button.textContent = label

  return button
}

function createDashboardSubsectionTitle(titleText) {
  const title = document.createElement('div')

  title.className = 'dashboard-section-title dashboard-subsection-title'
  title.textContent = titleText

  return title
}

function createSeedToggle(enabled) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  const text = document.createElement('span')

  label.className = 'dashboard-toggle'
  input.type = 'checkbox'
  input.dataset.simulationSeedToggle = 'true'
  input.checked = enabled
  text.textContent = 'use seed'

  label.appendChild(input)
  label.appendChild(text)

  return { label, input }
}

function createSeedField(seed) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')

  label.className = 'dashboard-field'
  text.textContent = 'random seed'
  input.type = 'text'
  input.value = seed
  input.autocomplete = 'off'
  input.spellcheck = false
  input.dataset.simulationSeed = 'true'

  label.appendChild(text)
  label.appendChild(input)

  return { label, input }
}

function createClockField() {
  const label = document.createElement('div')
  const text = document.createElement('span')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-clock-field'
  text.textContent = 'time'
  value.className = 'dashboard-clock-value'
  value.dataset.simulationClock = 'true'
  label.appendChild(text)
  label.appendChild(value)

  return { label, value }
}

function createSpeedField(speed, speedRange) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-slider-field'
  text.textContent = 'speed'
  input.type = 'range'
  input.min = String(speedRange.min)
  input.max = String(speedRange.max)
  input.step = String(speedRange.step)
  input.value = String(clampSpeed(speed, speedRange))
  input.dataset.simulationSpeed = 'true'
  value.className = 'dashboard-speed-value'
  value.textContent = formatSpeed(Number(input.value))
  label.appendChild(text)
  label.appendChild(input)
  label.appendChild(value)

  return { label, input, value }
}

function createNpcCountField(count, countRange) {
  return createCountField({
    labelText: 'NPCs',
    className: 'dashboard-npc-count-field',
    sliderDataset: 'simulationNpcCountSlider',
    inputDataset: 'simulationNpcCount',
    count,
    countRange,
    normalize: normalizeNpcCount
  })
}

function createCarCountField(count, countRange) {
  return createCountField({
    labelText: 'cars',
    className: 'dashboard-car-count-field',
    sliderDataset: 'simulationCarCountSlider',
    inputDataset: 'simulationCarCount',
    count,
    countRange,
    normalize: normalizeCarCount
  })
}

function createCountField({ labelText, className, sliderDataset, inputDataset, count, countRange, normalize }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const controls = document.createElement('div')
  const slider = document.createElement('input')
  const input = document.createElement('input')

  label.className = `dashboard-field ${className}`
  text.textContent = labelText
  controls.className = 'dashboard-paired-inputs'
  slider.type = 'range'
  slider.min = String(countRange.min)
  slider.max = String(countRange.max)
  slider.step = String(countRange.step)
  slider.value = String(normalize(count, countRange))
  slider.dataset[sliderDataset] = 'true'
  input.type = 'number'
  input.min = String(countRange.min)
  input.max = String(countRange.max)
  input.step = '1'
  input.value = String(normalize(count, countRange))
  input.dataset[inputDataset] = 'true'
  controls.appendChild(slider)
  controls.appendChild(input)
  label.appendChild(text)
  label.appendChild(controls)

  return { label, slider, input }
}

function createDayNightToggle(enabled) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  const text = document.createElement('span')

  label.className = 'dashboard-toggle'
  input.type = 'checkbox'
  input.dataset.simulationDayNightToggle = 'true'
  input.checked = enabled
  text.textContent = 'day-night overlay'

  label.appendChild(input)
  label.appendChild(text)

  return { label, input }
}

function createInfectionStatsField() {
  const label = document.createElement('div')
  const text = document.createElement('span')
  const value = document.createElement('output')

  label.className = 'dashboard-field dashboard-infection-stats-field'
  text.textContent = 'SEIR'
  value.className = 'dashboard-infection-stats-value'
  value.dataset.simulationInfectionStats = 'true'
  label.appendChild(text)
  label.appendChild(value)

  return { label, value }
}

function createInitialInfectiousCountField(count, range) {
  return createNumberField({
    labelText: 'initial infected',
    className: 'dashboard-initial-infectious-count-field',
    dataset: 'simulationInitialInfectiousCount',
    value: count,
    range,
    normalize: normalizeInitialInfectiousCount,
    format: String
  })
}

function createInfectionDistanceField(distance, range) {
  return createNumberField({
    labelText: 'infect dist',
    className: 'dashboard-infection-distance-field',
    dataset: 'simulationInfectionDistance',
    value: distance,
    range,
    normalize: normalizeInfectionDistance
  })
}

function createInfectionProbabilityField(probability, range) {
  return createNumberField({
    labelText: 'infect p/min',
    className: 'dashboard-infection-probability-field',
    dataset: 'simulationInfectionProbability',
    value: probability,
    range,
    normalize: normalizeInfectionProbability
  })
}

function createIncubationDaysField(days, range) {
  return createNumberField({
    labelText: 'incub days',
    className: 'dashboard-incubation-days-field',
    dataset: 'simulationIncubationDays',
    value: days,
    range,
    normalize: normalizeIncubationDays
  })
}

function createInfectionDaysField(days, range) {
  return createNumberField({
    labelText: 'infect days',
    className: 'dashboard-infection-days-field',
    dataset: 'simulationInfectionDays',
    value: days,
    range,
    normalize: normalizeInfectionDays
  })
}

function createImmunityDaysField(days, range) {
  return createNumberField({
    labelText: 'immune days',
    className: 'dashboard-immunity-days-field',
    dataset: 'simulationImmunityDays',
    value: days,
    range,
    normalize: normalizeImmunityDays
  })
}

function createNumberField({ labelText, className, dataset, value, range, normalize, format = formatNumberInput }) {
  const label = document.createElement('label')
  const text = document.createElement('span')
  const input = document.createElement('input')

  label.className = `dashboard-field ${className}`
  text.textContent = labelText
  input.type = 'number'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
  input.value = format(normalize(value, range))
  input.dataset[dataset] = 'true'
  label.appendChild(text)
  label.appendChild(input)

  return { label, input }
}

function normalizeSpeedRange(range) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isFinite(min) && Number.isFinite(max) && max >= min && Number.isFinite(step) && step > 0) {
    return { min, max, step }
  }

  return { min: 1, max: 16, step: 0.25 }
}

function normalizeNpcCountRange(range) {
  return normalizeIntegerRange(range, { min: 100, max: 10000, step: 100 })
}

function normalizeCarCountRange(range) {
  return normalizeIntegerRange(range, { min: 0, max: 2000, step: 10 })
}

function normalizeInitialInfectiousCountRange(range) {
  return normalizeIntegerRange(range, { min: 0, max: 10000, step: 1 })
}

function normalizeInfectionDistanceRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 256, step: 1 })
}

function normalizeInfectionProbabilityRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 1, step: 0.01 })
}

function normalizeIncubationDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 14, step: 0.25 })
}

function normalizeInfectionDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 21, step: 0.25 })
}

function normalizeImmunityDaysRange(range) {
  return normalizeNumberRange(range, { min: 0, max: 365, step: 1 })
}

function normalizeIntegerRange(range, fallback) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isInteger(min) && min >= 0 && Number.isInteger(max) && max >= min && Number.isInteger(step) && step > 0) {
    return { min, max, step }
  }

  return fallback
}

function normalizeNumberRange(range, fallback) {
  const min = Number(range && range.min)
  const max = Number(range && range.max)
  const step = Number(range && range.step)

  if (Number.isFinite(min) && min >= 0 && Number.isFinite(max) && max >= min && Number.isFinite(step) && step > 0) {
    return { min, max, step }
  }

  return fallback
}

function normalizeNpcCount(count, range) {
  const countRange = normalizeNpcCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeCarCount(count, range) {
  const countRange = normalizeCarCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeInitialInfectiousCount(count, range) {
  const countRange = normalizeInitialInfectiousCountRange(range)
  const value = Math.round(Number(count))

  if (!Number.isFinite(value)) {
    return countRange.min
  }

  return Math.min(Math.max(value, countRange.min), countRange.max)
}

function normalizeInfectionDistance(distance, range) {
  return normalizeNumberInRange(distance, normalizeInfectionDistanceRange(range))
}

function normalizeInfectionProbability(probability, range) {
  return normalizeNumberInRange(probability, normalizeInfectionProbabilityRange(range))
}

function normalizeIncubationDays(days, range) {
  return normalizeNumberInRange(days, normalizeIncubationDaysRange(range))
}

function normalizeInfectionDays(days, range) {
  return normalizeNumberInRange(days, normalizeInfectionDaysRange(range))
}

function normalizeImmunityDays(days, range) {
  return normalizeNumberInRange(days, normalizeImmunityDaysRange(range))
}

function normalizeNumberInRange(value, range) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return range.min
  }

  return Math.min(Math.max(number, range.min), range.max)
}

function clampSpeed(speed, range) {
  if (!Number.isFinite(speed)) {
    return range.min
  }

  return Math.min(Math.max(speed, range.min), range.max)
}

function formatSpeed(speed) {
  return `${Number(speed.toFixed(2))}x`
}

function formatNumberInput(value) {
  return String(Number(value.toFixed(4)))
}

function formatClockDisplay(clock) {
  if (!clock || typeof clock.formatTimeOfDay !== 'function') {
    return '--:--'
  }

  const dayIndex = typeof clock.getDayIndex === 'function' ? clock.getDayIndex() : 0

  return `day ${dayIndex + 1} ${clock.formatTimeOfDay()}`
}

function formatInfectionStats(stats) {
  if (!stats) {
    return 'S 0 E 0 I 0 R 0'
  }

  return `S ${formatStatCount(stats.susceptible)} E ${formatStatCount(stats.exposed)} I ${formatStatCount(stats.infectious)} R ${formatStatCount(stats.recovered)}`
}

function formatStatCount(count) {
  const value = Math.round(Number(count))

  return Number.isFinite(value) && value >= 0 ? value : 0
}

function createOverlayToggle(overlay) {
  const label = document.createElement('label')
  const input = document.createElement('input')
  const text = document.createElement('span')

  label.className = 'dashboard-toggle'
  input.type = 'checkbox'
  input.dataset.overlayToggle = overlay.id
  text.textContent = overlay.label

  label.appendChild(input)
  label.appendChild(text)

  return { label, input }
}

function isEditableTarget(target) {
  if (!target || !target.tagName) {
    return false
  }

  if (target.tagName === 'INPUT' && target.type === 'checkbox') {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

function isInteractiveTarget(target) {
  if (!target || !target.tagName) {
    return false
  }

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

function isSpaceHotkey(event) {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

function noop() {}

function createOverlayLayer(entityLayer) {
  entityLayer.sortableChildren = true

  return {
    children: [],
    visible: true,
    addChild(child) {
      this.children.push(child)
      entityLayer.addChild(child)
    }
  }
}

function setOverlayLayerVisible(layer, visible) {
  layer.visible = visible

  for (const child of layer.children) {
    child.visible = visible
  }
}

function destroyOverlayLayer(layer) {
  for (const child of layer.children) {
    if (child.parent && typeof child.parent.removeChild === 'function') {
      child.parent.removeChild(child)
    }

    child.destroy({ children: true })
  }

  layer.children.length = 0
}

function drawTileTypeOverlay(city, layer) {
  drawChunkedOverlay(city, layer, (graphics, x, y) => {
    const variant = city.getTileVariant(x, y)

    if (variant.category === 'crosswalk') {
      drawCrosswalkTileTypeOverlay(graphics, city, x, y)
      return
    }

    fillRect(
      graphics,
      x * city.tileSize,
      y * city.tileSize,
      city.tileSize,
      city.tileSize,
      TILE_TYPE_OVERLAY_COLORS[variant.category] || TILE_TYPE_OVERLAY_COLORS.building,
      TILE_TYPE_OVERLAY_COLORS.alpha
    )
  })
}

function drawBehaviorOverlay(city, layer, propertyLayer) {
  drawChunkedOverlay(city, layer, (graphics, x, y) => {
    const enabled = propertyLayer[city.index(x, y)] === 1

    fillRect(
      graphics,
      x * city.tileSize,
      y * city.tileSize,
      city.tileSize,
      city.tileSize,
      enabled ? DEBUG_OVERLAY_COLORS.enabled : DEBUG_OVERLAY_COLORS.disabled,
      enabled ? DEBUG_OVERLAY_COLORS.enabledAlpha : DEBUG_OVERLAY_COLORS.disabledAlpha
    )
  })
}

function drawCrosswalkTileTypeOverlay(graphics, city, x, y) {
  const tileSize = city.tileSize
  const px = x * tileSize
  const py = y * tileSize
  const stripeCount = 4
  const stripeWidth = Math.max(2, Math.round(tileSize * 0.12))
  const stripeGap = Math.max(2, Math.round(tileSize * 0.09))
  const stripeHeight = Math.max(1, tileSize - Math.round(tileSize * 0.22))
  const stripeTop = py + Math.round((tileSize - stripeHeight) / 2)
  const stripeSpan = stripeCount * stripeWidth + (stripeCount - 1) * stripeGap
  const stripeLeft = px + Math.round((tileSize - stripeSpan) / 2)

  fillRect(graphics, px, py, tileSize, tileSize, TILE_TYPE_OVERLAY_COLORS.crosswalk, TILE_TYPE_OVERLAY_COLORS.alpha)

  for (let stripe = 0; stripe < stripeCount; stripe += 1) {
    fillRect(
      graphics,
      stripeLeft + stripe * (stripeWidth + stripeGap),
      stripeTop,
      stripeWidth,
      stripeHeight,
      TILE_TYPE_OVERLAY_COLORS.crosswalkStripe,
      TILE_TYPE_OVERLAY_COLORS.alpha
    )
  }
}

function drawChunkedOverlay(city, layer, drawTile) {
  const chunkSize = 16

  for (let chunkY = 0; chunkY < city.height; chunkY += chunkSize) {
    for (let chunkX = 0; chunkX < city.width; chunkX += chunkSize) {
      const graphicsByZorder = new Map()

      for (let y = chunkY; y < Math.min(city.height, chunkY + chunkSize); y += 1) {
        for (let x = chunkX; x < Math.min(city.width, chunkX + chunkSize); x += 1) {
          const zorder = city.tileZOrders[city.index(x, y)]
          const graphics = ensureOverlayGraphics(layer, graphicsByZorder, zorder)

          drawTile(graphics, x, y)
        }
      }
    }
  }
}

function ensureOverlayGraphics(layer, graphicsByZorder, zorder) {
  if (!graphicsByZorder.has(zorder)) {
    const graphics = new PIXI.Graphics()

    graphics.eventMode = 'none'
    graphics.zIndex = zorder
    graphics.zorder = zorder
    graphicsByZorder.set(zorder, graphics)
    layer.addChild(graphics)
  }

  return graphicsByZorder.get(zorder)
}
