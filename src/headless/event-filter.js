export const HEADLESS_EVENT_TYPES = Object.freeze([
  'contact',
  'infection',
  'incubation',
  'recovery',
  'immunity_waned',
  'policy_effect_change'
])

const HEADLESS_EVENT_TYPE_SET = new Set(HEADLESS_EVENT_TYPES)

export function normalizeEventFilter(filter = {}, labels = {}) {
  const source = filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : {}

  return {
    events: normalizeEventTypeList(
      source.events ?? source.includeEvents ?? source.include,
      labels.events || 'events'
    ),
    omitEvents: normalizeEventTypeList(
      source.omitEvents ?? source.omit,
      labels.omitEvents || 'omitEvents'
    )
  }
}

export function mergeEventFilters(base = {}, overrides = {}) {
  const normalizedBase = normalizeEventFilter(base)
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}

  return normalizeEventFilter({
    events: hasOverride(source, 'events') ? source.events : normalizedBase.events,
    omitEvents: hasOverride(source, 'omitEvents') ? source.omitEvents : normalizedBase.omitEvents
  }, {
    events: '--events',
    omitEvents: '--omit-events'
  })
}

export function filterEvents(events, filter = {}) {
  const normalized = normalizeEventFilter(filter)
  const included = normalized.events.length > 0 ? new Set(normalized.events) : null
  const omitted = normalized.omitEvents.length > 0 ? new Set(normalized.omitEvents) : null

  if (!included && !omitted) {
    return events
  }

  return events.filter((event) => {
    const eventType = event?.event
    return (!included || included.has(eventType)) && (!omitted || !omitted.has(eventType))
  })
}

function normalizeEventTypeList(value, label) {
  if (value == null) {
    return []
  }

  const values = flattenEventTypeValues(value)
  const normalized = []
  const seen = new Set()

  for (const rawValue of values) {
    const eventType = String(rawValue).trim()

    if (!eventType) {
      continue
    }

    if (!HEADLESS_EVENT_TYPE_SET.has(eventType)) {
      throw new Error(
        `Unknown headless event type "${eventType}" for ${label}. ` +
        `Valid event types: ${HEADLESS_EVENT_TYPES.join(', ')}.`
      )
    }

    if (!seen.has(eventType)) {
      seen.add(eventType)
      normalized.push(eventType)
    }
  }

  return normalized
}

function flattenEventTypeValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenEventTypeValues)
  }

  return String(value).split(',')
}

function hasOverride(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key) && source[key] != null
}
