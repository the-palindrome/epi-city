const STATE_CODE = {
  susceptible: 0,
  exposed: 1,
  infectious: 2,
  recovered: 3
}

const STATE_NAME = ['susceptible', 'exposed', 'infectious', 'recovered']

let dataset = null
const datasets = new Map()

self.onmessage = async (message) => {
  const data = message.data || {}

  try {
    if (data.type === 'load') {
      await loadDataset(data)
      return
    }

    if (data.type === 'window') {
      postWindow(data)
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: data.requestId,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

async function loadDataset({ file, sourceName, datasetId = 'default', maxLayoutLinks = 6000, maxVisibleContactEdges = 12000 }) {
  if (!file || typeof file.text !== 'function') {
    throw new Error('No result file was provided.')
  }

  self.postMessage({ type: 'status', message: `Reading ${sourceName || file.name || 'result JSON'}` })
  let text = await file.text()

  self.postMessage({ type: 'status', message: 'Parsing JSON' })
  let results = JSON.parse(text)
  text = null

  self.postMessage({ type: 'status', message: 'Indexing events' })
  dataset = normalizeResults(results)
  datasets.set(datasetId, dataset)
  results = null

  const layout = buildLayoutLinks(dataset, maxLayoutLinks)
  const initialStateCodes = dataset.initialStateCodes.slice()
  const fullInfectionSource = dataset.infectionSource.slice()
  const fullInfectionTarget = dataset.infectionTarget.slice()
  const fullInfectionTileX = dataset.infectionTileX.slice()
  const fullInfectionTileY = dataset.infectionTileY.slice()
  const seirSeries = dataset.seirSeries
  const transfer = [
    initialStateCodes.buffer,
    fullInfectionSource.buffer,
    fullInfectionTarget.buffer,
    fullInfectionTileX.buffer,
    fullInfectionTileY.buffer,
    layout.source.buffer,
    layout.target.buffer,
    layout.count.buffer,
    seirSeries.time.buffer,
    seirSeries.susceptible.buffer,
    seirSeries.exposed.buffer,
    seirSeries.infectious.buffer,
    seirSeries.recovered.buffer
  ]

  self.postMessage({
    type: 'loaded',
    datasetId,
    sourceName,
    maxVisibleContactEdges,
    npcs: dataset.npcs,
    initialStateCodes,
    fullInfectionSource,
    fullInfectionTarget,
    fullInfectionTileX,
    fullInfectionTileY,
    layout,
    seirSeries,
    minTime: dataset.minTime,
    maxTime: dataset.maxTime,
    eventCounts: dataset.eventCounts,
    contactCount: dataset.contactCount,
    infectionCount: dataset.infectionCount,
    contactPairCount: dataset.pairSources.length
  }, transfer)
}

function normalizeResults(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    throw new Error('Result payload must be a JSON object.')
  }

  if (!Array.isArray(results.npcs)) {
    throw new Error('Result payload must include npcs array.')
  }

  if (!Array.isArray(results.events)) {
    throw new Error('Result payload must include events array.')
  }

  const npcs = results.npcs.map((npc, index) => {
    const initialSeirState = normalizeSeirState(npc?.initialSeirState)

    return {
      id: String(npc?.id || `npc_${index}`),
      index,
      initialSeirState,
      initialSeirStateCode: STATE_CODE[initialSeirState]
    }
  })
  const npcIndex = new Map(npcs.map((npc, index) => [npc.id, index]))
  const initialStateCodes = new Int8Array(npcs.length)

  for (const npc of npcs) {
    initialStateCodes[npc.index] = npc.initialSeirStateCode
  }

  const eventCounts = {}
  let contactCount = 0
  let infectionCount = 0
  let seirCount = 0

  for (const event of results.events) {
    const eventName = event?.event
    eventCounts[eventName] = (eventCounts[eventName] || 0) + 1

    if (eventName === 'contact') {
      contactCount += 1
    } else if (eventName === 'infection') {
      infectionCount += 1
      seirCount += 1
    } else if (isNpcSeirEvent(eventName)) {
      seirCount += 1
    }
  }

  let validContactCount = 0
  let validInfectionCount = 0
  let validSeirCount = 0
  let minEventTime = Infinity
  let maxEventTime = 0
  const contactStart = new Float64Array(contactCount)
  const contactEnd = new Float64Array(contactCount)
  const contactPair = new Int32Array(contactCount)
  const infectionSource = new Int32Array(infectionCount)
  const infectionTarget = new Int32Array(infectionCount)
  const infectionAt = new Float64Array(infectionCount)
  const infectionPair = new Int32Array(infectionCount)
  const infectionTileX = new Float64Array(infectionCount)
  const infectionTileY = new Float64Array(infectionCount)
  const seirAt = new Float64Array(seirCount)
  const seirNpc = new Int32Array(seirCount)
  const seirToState = new Int8Array(seirCount)
  const seirOrder = new Int32Array(seirCount)
  const pairIdByKey = new Map()
  const pairSources = []
  const pairTargets = []
  const globalPairCounts = []
  const npcCount = Math.max(1, npcs.length)

  infectionPair.fill(-1)

  for (const event of results.events) {
    if (event?.event === 'contact' && Array.isArray(event.npcs) && event.npcs.length >= 2) {
      const source = npcIndex.get(String(event.npcs[0]))
      const target = npcIndex.get(String(event.npcs[1]))
      const rawAt = Number(event.at)
      const rawUntil = Number(event.until ?? event.at)

      if (!Number.isInteger(source) || !Number.isInteger(target) || source === target ||
          !Number.isFinite(rawAt) || !Number.isFinite(rawUntil)) {
        continue
      }

      const at = Math.min(rawAt, rawUntil)
      const until = Math.max(rawAt, rawUntil)
      const low = Math.min(source, target)
      const high = Math.max(source, target)
      const pairKey = low * npcCount + high
      let pairId = pairIdByKey.get(pairKey)

      if (pairId === undefined) {
        pairId = pairSources.length
        pairIdByKey.set(pairKey, pairId)
        pairSources.push(low)
        pairTargets.push(high)
        globalPairCounts.push(0)
      }

      globalPairCounts[pairId] += 1
      contactStart[validContactCount] = at
      contactEnd[validContactCount] = until
      contactPair[validContactCount] = pairId
      validContactCount += 1
      minEventTime = Math.min(minEventTime, at, until)
      maxEventTime = Math.max(maxEventTime, at, until)
      continue
    }

    if (event?.event === 'infection') {
      const source = npcIndex.get(String(event.from))
      const target = npcIndex.get(String(event.to))
      const at = Number(event.at)

      if (!Number.isInteger(source) || !Number.isInteger(target) || source === target ||
          !Number.isFinite(at)) {
        continue
      }

      infectionSource[validInfectionCount] = source
      infectionTarget[validInfectionCount] = target
      infectionAt[validInfectionCount] = at
      infectionTileX[validInfectionCount] = Number.isFinite(Number(event.where?.tile?.x)) ? Number(event.where.tile.x) : NaN
      infectionTileY[validInfectionCount] = Number.isFinite(Number(event.where?.tile?.y)) ? Number(event.where.tile.y) : NaN
      validInfectionCount += 1
      validSeirCount = addSeirEvent(seirAt, seirNpc, seirToState, seirOrder, validSeirCount, at, target, 'infection')
      minEventTime = Math.min(minEventTime, at)
      maxEventTime = Math.max(maxEventTime, at)
      continue
    }

    if (isNpcSeirEvent(event?.event)) {
      const npc = npcIndex.get(String(event.npc))
      const at = Number(event.at)

      if (Number.isInteger(npc) && Number.isFinite(at)) {
        validSeirCount = addSeirEvent(seirAt, seirNpc, seirToState, seirOrder, validSeirCount, at, npc, event.event)
        minEventTime = Math.min(minEventTime, at)
        maxEventTime = Math.max(maxEventTime, at)
      }
    }
  }

  const configuredDuration = Number(results.summary?.durationSeconds ?? results.config?.run?.durationSeconds)

  if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
    maxEventTime = Math.max(maxEventTime, configuredDuration)
  }

  for (let index = 0; index < validInfectionCount; index += 1) {
    const source = infectionSource[index]
    const target = infectionTarget[index]
    const low = Math.min(source, target)
    const high = Math.max(source, target)
    const pairKey = low * npcCount + high
    const pairId = pairIdByKey.get(pairKey)

    infectionPair[index] = pairId === undefined ? -1 : pairId
  }

  if (!Number.isFinite(minEventTime)) {
    minEventTime = 0
  }

  const seirSorted = sortSeirEvents(
    seirAt.slice(0, validSeirCount),
    seirNpc.slice(0, validSeirCount),
    seirToState.slice(0, validSeirCount),
    seirOrder.slice(0, validSeirCount)
  )
  const minTime = Math.floor(Math.max(0, minEventTime))
  const maxTime = Math.ceil(Math.max(minTime + 1, maxEventTime))
  const normalized = {
    npcs,
    initialStateCodes,
    contactStart: contactStart.slice(0, validContactCount),
    contactEnd: contactEnd.slice(0, validContactCount),
    contactPair: contactPair.slice(0, validContactCount),
    infectionSource: infectionSource.slice(0, validInfectionCount),
    infectionTarget: infectionTarget.slice(0, validInfectionCount),
    infectionAt: infectionAt.slice(0, validInfectionCount),
    infectionPair: infectionPair.slice(0, validInfectionCount),
    infectionTileX: infectionTileX.slice(0, validInfectionCount),
    infectionTileY: infectionTileY.slice(0, validInfectionCount),
    seirAt: seirSorted.at,
    seirNpc: seirSorted.npc,
    seirToState: seirSorted.toState,
    pairSources: Int32Array.from(pairSources),
    pairTargets: Int32Array.from(pairTargets),
    globalPairCounts: Uint32Array.from(globalPairCounts),
    minTime,
    maxTime,
    eventCounts,
    contactCount: validContactCount,
    infectionCount: validInfectionCount
  }

  normalized.seirSeries = buildSeirSeries(normalized)
  normalized.pairCountsScratch = new Uint32Array(normalized.pairSources.length)
  normalized.degreeScratch = new Uint32Array(npcs.length)

  return normalized
}

function addSeirEvent(seirAt, seirNpc, seirToState, seirOrder, index, at, npc, eventName) {
  const toState = nextStateForEvent(eventName)

  if (toState < 0) {
    return index
  }

  seirAt[index] = at
  seirNpc[index] = npc
  seirToState[index] = toState
  seirOrder[index] = index
  return index + 1
}

function sortSeirEvents(at, npc, toState, order) {
  const indices = Array.from({ length: at.length }, (_, index) => index)
  indices.sort((left, right) => (
    at[left] - at[right] ||
    order[left] - order[right] ||
    npc[left] - npc[right]
  ))

  const sortedAt = new Float64Array(indices.length)
  const sortedNpc = new Int32Array(indices.length)
  const sortedToState = new Int8Array(indices.length)

  for (let index = 0; index < indices.length; index += 1) {
    const sourceIndex = indices[index]
    sortedAt[index] = at[sourceIndex]
    sortedNpc[index] = npc[sourceIndex]
    sortedToState[index] = toState[sourceIndex]
  }

  return {
    at: sortedAt,
    npc: sortedNpc,
    toState: sortedToState
  }
}

function buildSeirSeries(data) {
  const counts = new Int32Array(4)
  const states = data.initialStateCodes.slice()
  const times = [0]
  const susceptible = []
  const exposed = []
  const infectious = []
  const recovered = []

  for (const state of states) {
    counts[state] += 1
  }

  setLastCounts(susceptible, exposed, infectious, recovered, counts)

  for (let index = 0; index < data.seirAt.length;) {
    const time = Math.max(0, data.seirAt[index])
    let changed = false

    while (index < data.seirAt.length && Math.max(0, data.seirAt[index]) === time) {
      changed = moveState(counts, states, data.seirNpc[index], data.seirToState[index]) || changed
      index += 1
    }

    if (changed) {
      times.push(time)
      setLastCounts(susceptible, exposed, infectious, recovered, counts)
    }
  }

  const lastTime = Math.max(data.maxTime, times[times.length - 1] || 0)

  if (times[times.length - 1] !== lastTime) {
    times.push(lastTime)
    setLastCounts(susceptible, exposed, infectious, recovered, counts)
  }

  return {
    time: Float64Array.from(times),
    susceptible: Int32Array.from(susceptible),
    exposed: Int32Array.from(exposed),
    infectious: Int32Array.from(infectious),
    recovered: Int32Array.from(recovered),
    maxCount: Math.max(1, data.npcs.length),
    maxTime: Math.max(1, data.maxTime)
  }
}

function setLastCounts(susceptible, exposed, infectious, recovered, counts) {
  susceptible.push(counts[STATE_CODE.susceptible])
  exposed.push(counts[STATE_CODE.exposed])
  infectious.push(counts[STATE_CODE.infectious])
  recovered.push(counts[STATE_CODE.recovered])
}

function buildLayoutLinks(data, maxLayoutLinks) {
  const pairIds = Array.from({ length: data.pairSources.length }, (_, index) => index)
  pairIds.sort((left, right) => data.globalPairCounts[right] - data.globalPairCounts[left])

  const limit = Math.min(Math.max(0, maxLayoutLinks), pairIds.length)
  const source = new Int32Array(limit)
  const target = new Int32Array(limit)
  const count = new Uint32Array(limit)

  for (let index = 0; index < limit; index += 1) {
    const pairId = pairIds[index]
    source[index] = data.pairSources[pairId]
    target[index] = data.pairTargets[pairId]
    count[index] = data.globalPairCounts[pairId]
  }

  return { source, target, count }
}

function postWindow({ requestId, datasetId = 'default', datasetIds, start, end, maxVisibleContactEdges = 12000 }) {
  const selectedDatasets = selectedWindowDatasets(datasetIds, datasetId)

  if (selectedDatasets.length === 0) {
    throw new Error('Load a result file before filtering a time window.')
  }

  const windowStart = Math.min(Number(start), Number(end))
  const windowEnd = Math.max(Number(start), Number(end))
  const firstDataset = selectedDatasets[0]
  const npcCount = firstDataset.npcs.length
  const pairCounts = new Map()
  const pairSourceByKey = new Map()
  const pairTargetByKey = new Map()
  const infectionCounts = new Map()
  const infectionSourceByKey = new Map()
  const infectionTargetByKey = new Map()
  const pinnedPairKeys = new Set()
  const degrees = new Uint32Array(npcCount)
  let contactEventCount = 0
  let infectionEventCount = 0

  for (const data of selectedDatasets) {
    for (let index = 0; index < data.contactStart.length; index += 1) {
      if (data.contactEnd[index] < windowStart || data.contactStart[index] > windowEnd) {
        continue
      }

      const pairId = data.contactPair[index]
      const source = data.pairSources[pairId]
      const target = data.pairTargets[pairId]
      const pairKey = nodePairKey(source, target, npcCount)

      if (!pairCounts.has(pairKey)) {
        pairSourceByKey.set(pairKey, source)
        pairTargetByKey.set(pairKey, target)
      }

      pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1)
      contactEventCount += 1
      degrees[source] += 1
      degrees[target] += 1
    }

    for (let index = 0; index < data.infectionAt.length; index += 1) {
      if (data.infectionAt[index] < windowStart || data.infectionAt[index] > windowEnd) {
        continue
      }

      const source = data.infectionSource[index]
      const target = data.infectionTarget[index]
      const directedKey = source * Math.max(1, npcCount) + target
      const pairKey = nodePairKey(source, target, npcCount)

      if (!infectionCounts.has(directedKey)) {
        infectionSourceByKey.set(directedKey, source)
        infectionTargetByKey.set(directedKey, target)
      }

      infectionCounts.set(directedKey, (infectionCounts.get(directedKey) || 0) + 1)
      infectionEventCount += 1
      degrees[source] += 1
      degrees[target] += 1
      pinnedPairKeys.add(pairKey)
    }
  }

  const activePairKeys = [...pairCounts.keys()]
  const pinnedPairKeySet = new Set([...pinnedPairKeys].filter((pairKey) => pairCounts.has(pairKey)))

  if (activePairKeys.length > maxVisibleContactEdges) {
    activePairKeys.sort((left, right) => (
      pairCounts.get(right) - pairCounts.get(left) ||
      pairSourceByKey.get(left) - pairSourceByKey.get(right) ||
      pairTargetByKey.get(left) - pairTargetByKey.get(right)
    ))
  }

  const contactPairLimit = Math.max(0, maxVisibleContactEdges)
  const visiblePairKeys = activePairKeys.length <= contactPairLimit
    ? activePairKeys
    : selectVisibleContactPairs(activePairKeys, [...pinnedPairKeySet], pinnedPairKeySet, contactPairLimit)
  const visibleContactCount = visiblePairKeys.length
  const contactSource = new Int32Array(visibleContactCount)
  const contactTarget = new Int32Array(visibleContactCount)
  const contactWeight = new Uint32Array(visibleContactCount)
  const matrixPairCount = activePairKeys.length
  const matrixSource = new Int32Array(matrixPairCount)
  const matrixTarget = new Int32Array(matrixPairCount)
  const matrixWeight = new Uint32Array(matrixPairCount)
  let maxContactWeight = 0

  for (let index = 0; index < visibleContactCount; index += 1) {
    const pairKey = visiblePairKeys[index]
    const weight = pairCounts.get(pairKey) || 0

    contactSource[index] = pairSourceByKey.get(pairKey)
    contactTarget[index] = pairTargetByKey.get(pairKey)
    contactWeight[index] = weight
    maxContactWeight = Math.max(maxContactWeight, weight)
  }

  for (let index = 0; index < matrixPairCount; index += 1) {
    const pairKey = activePairKeys[index]
    const weight = pairCounts.get(pairKey) || 0

    matrixSource[index] = pairSourceByKey.get(pairKey)
    matrixTarget[index] = pairTargetByKey.get(pairKey)
    matrixWeight[index] = weight
    maxContactWeight = Math.max(maxContactWeight, weight)
  }

  const infectionKeys = [...infectionCounts.keys()]
  const infectionSource = new Int32Array(infectionKeys.length)
  const infectionTarget = new Int32Array(infectionKeys.length)
  const infectionWeight = new Uint32Array(infectionKeys.length)

  for (let index = 0; index < infectionKeys.length; index += 1) {
    const key = infectionKeys[index]

    infectionSource[index] = infectionSourceByKey.get(key)
    infectionTarget[index] = infectionTargetByKey.get(key)
    infectionWeight[index] = infectionCounts.get(key) || 0
  }

  let activeNodeCount = 0

  for (let index = 0; index < degrees.length; index += 1) {
    if (degrees[index] > 0) {
      activeNodeCount += 1
    }
  }

  const currentStates = statesAtTime(firstDataset, windowEnd)
  const degreeCopy = degrees.slice()
  const transfer = [
    contactSource.buffer,
    contactTarget.buffer,
    contactWeight.buffer,
    matrixSource.buffer,
    matrixTarget.buffer,
    matrixWeight.buffer,
    infectionSource.buffer,
    infectionTarget.buffer,
    infectionWeight.buffer,
    currentStates.buffer,
    degreeCopy.buffer
  ]

  self.postMessage({
    type: 'window',
    requestId,
    start: windowStart,
    end: windowEnd,
    contactSource,
    contactTarget,
    contactWeight,
    matrixSource,
    matrixTarget,
    matrixWeight,
    infectionSource,
    infectionTarget,
    infectionWeight,
    currentStates,
    degrees: degreeCopy,
    contactEventCount,
    activeNodeCount,
    totalContactPairCount: activePairKeys.length,
    visibleContactPairCount: visibleContactCount,
    infectionEventCount,
    maxContactWeight
  }, transfer)
}

function selectedWindowDatasets(datasetIds, datasetId) {
  const ids = Array.isArray(datasetIds) && datasetIds.length > 0 ? datasetIds : [datasetId]
  const selected = []

  for (const id of ids) {
    const selectedDataset = datasets.get(id)

    if (selectedDataset) {
      selected.push(selectedDataset)
    }
  }

  if (selected.length === 0 && dataset) {
    selected.push(dataset)
  }

  return selected
}

function selectVisibleContactPairs(activePairKeys, pinnedPairKeys, pinnedPairKeySet, contactPairLimit) {
  const visiblePairKeys = []
  const targetCount = Math.max(contactPairLimit, pinnedPairKeys.length)

  for (const pairKey of pinnedPairKeys) {
    visiblePairKeys.push(pairKey)
  }

  for (const pairKey of activePairKeys) {
    if (visiblePairKeys.length >= targetCount) {
      break
    }

    if (pinnedPairKeySet.has(pairKey)) {
      continue
    }

    visiblePairKeys.push(pairKey)
  }

  return visiblePairKeys
}

function nodePairKey(source, target, npcCount) {
  const low = Math.min(source, target)
  const high = Math.max(source, target)

  return low * Math.max(1, npcCount) + high
}

function statesAtTime(data, time) {
  const states = data.initialStateCodes.slice()
  const counts = new Int32Array(4)

  for (const state of states) {
    counts[state] += 1
  }

  for (let index = 0; index < data.seirAt.length && data.seirAt[index] <= time; index += 1) {
    moveState(counts, states, data.seirNpc[index], data.seirToState[index])
  }

  return states
}

function moveState(counts, states, npc, toState) {
  const fromState = states[npc]

  if (fromState === toState) {
    return false
  }

  if (!isValidStateCode(fromState) || !isValidStateCode(toState) || !isValidSeirTransition(fromState, toState)) {
    return false
  }

  if (counts[fromState] > 0) {
    counts[fromState] -= 1
  }

  counts[toState] += 1
  states[npc] = toState
  return true
}

function isValidStateCode(state) {
  return state >= STATE_CODE.susceptible && state <= STATE_CODE.recovered
}

function isValidSeirTransition(fromState, toState) {
  return (
    (fromState === STATE_CODE.susceptible && toState === STATE_CODE.exposed) ||
    (fromState === STATE_CODE.exposed && toState === STATE_CODE.infectious) ||
    (fromState === STATE_CODE.infectious && toState === STATE_CODE.recovered) ||
    (fromState === STATE_CODE.recovered && toState === STATE_CODE.susceptible)
  )
}

function nextStateForEvent(eventName) {
  if (eventName === 'infection') {
    return STATE_CODE.exposed
  }

  if (eventName === 'incubation') {
    return STATE_CODE.infectious
  }

  if (eventName === 'recovery') {
    return STATE_CODE.recovered
  }

  if (eventName === 'immunity_waned') {
    return STATE_CODE.susceptible
  }

  return -1
}

function normalizeSeirState(value) {
  const stateName = String(value || 'susceptible')

  return STATE_NAME.includes(stateName) ? stateName : 'susceptible'
}

function isNpcSeirEvent(eventName) {
  return eventName === 'incubation' || eventName === 'recovery' || eventName === 'immunity_waned'
}
