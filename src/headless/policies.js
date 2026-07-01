const POLICY_METRICS = Object.freeze([
  'activeCases',
  'infectiousCases',
  'exposedCases',
  'recoveredCases',
  'susceptibleCases'
])
const POLICY_OPERATORS = Object.freeze(['>=', '<='])
const POLICY_UNITS = Object.freeze(['percentPopulation', 'people'])
const POLICY_ACTIONS = Object.freeze([
  'socialDistancing',
  'wearMask',
  'closeSchools',
  'homeOffice',
  'reduceShopping',
  'reduceNightlife'
])
const POLICY_INTENSITIES = Object.freeze(['light', 'moderate', 'strict'])
const MASK_INFECTION_PROBABILITY_MULTIPLIERS = Object.freeze({
  light: 0.65,
  moderate: 0.4,
  strict: 0.2
})
const POLICY_EVENT_ACTIONS = Object.freeze(['closeSchools', 'homeOffice', 'reduceShopping', 'reduceNightlife'])
const POLICY_TRANSMISSION_ACTIONS = Object.freeze(['wearMask'])
const EMPTY_EVENT_CANCELLATIONS = Object.freeze({
  closeSchools: 0,
  homeOffice: 0,
  reduceShopping: 0,
  reduceNightlife: 0
})
const DEFAULT_POLICIES = Object.freeze([
  Object.freeze({
    id: 'policy-1',
    enabled: true,
    active: false,
    metric: 'activeCases',
    operator: '>=',
    threshold: 5,
    unit: 'percentPopulation',
    action: 'socialDistancing',
    intensity: 'moderate',
    cancellationProbability: 0.5,
    untilOperator: '<=',
    untilThreshold: 2,
    untilUnit: 'percentPopulation'
  })
])

export function normalizePolicyList(policies) {
  if (policies == null) {
    return []
  }

  if (!Array.isArray(policies)) {
    throw new TypeError('policies must be an array.')
  }

  return policies.map((policy, index) => normalizePolicy(policy, index))
}

export function getDefaultHeadlessPolicies() {
  return DEFAULT_POLICIES.map((policy) => ({ ...policy }))
}

export function createPolicyEvaluator(policies, population) {
  const state = normalizePolicyList(policies)
  const normalizedPopulation = Math.max(0, Math.round(Number(population)) || 0)

  return {
    evaluate(stats) {
      const activePolicies = []
      const context = {
        stats: normalizeStats(stats),
        population: normalizedPopulation
      }

      for (const policy of state) {
        if (!policy.enabled) {
          policy.active = false
          continue
        }

        const shouldActivate = testCondition(policy, context, {
          operator: policy.operator,
          threshold: policy.threshold,
          unit: policy.unit
        })
        const shouldDeactivate = testCondition(policy, context, {
          operator: policy.untilOperator,
          threshold: policy.untilThreshold,
          unit: policy.untilUnit
        })

        policy.active = policy.active ? !shouldDeactivate : shouldActivate

        if (policy.active) {
          activePolicies.push(policy)
        }
      }

      return createPolicyEffects(activePolicies)
    }
  }
}

export function createPolicyEffects(activePolicies) {
  const policies = Array.isArray(activePolicies) ? activePolicies : []
  const eventCancellationProbabilities = { ...EMPTY_EVENT_CANCELLATIONS }
  const infectionProbabilityMultiplier = policies.reduce(
    (multiplier, policy) => Math.min(multiplier, getInfectionProbabilityMultiplier(policy)),
    1
  )

  for (const policy of policies) {
    if (POLICY_EVENT_ACTIONS.includes(policy.action)) {
      eventCancellationProbabilities[policy.action] = Math.max(
        eventCancellationProbabilities[policy.action],
        normalizeProbability(policy.cancellationProbability)
      )
    }
  }

  return {
    infectionProbabilityMultiplier,
    socialDistancingEnabled: policies.some((policy) => policy.action === 'socialDistancing'),
    eventCancellationProbabilities,
    activePolicies: policies.map((policy) => ({
      id: policy.id,
      action: policy.action,
      intensity: policy.intensity,
      cancellationProbability: normalizeProbability(policy.cancellationProbability),
      infectionProbabilityMultiplier: getInfectionProbabilityMultiplier(policy)
    }))
  }
}

export function getPolicyEffectsKey(effects) {
  const source = effects || createPolicyEffects([])
  const cancellations = source.eventCancellationProbabilities || EMPTY_EVENT_CANCELLATIONS

  return [
    probabilityKey(source.infectionProbabilityMultiplier),
    source.socialDistancingEnabled ? '1' : '0',
    probabilityKey(cancellations.closeSchools),
    probabilityKey(cancellations.homeOffice),
    probabilityKey(cancellations.reduceShopping),
    probabilityKey(cancellations.reduceNightlife),
    (source.activePolicies || []).map((policy) => policy.id).join(',')
  ].join(':')
}

function normalizePolicy(policy, index) {
  const source = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {}
  const fallback = DEFAULT_POLICIES[0]

  return {
    id: String(source.id || `policy-${index + 1}`),
    enabled: source.enabled !== false,
    active: Boolean(source.active),
    metric: enumValue(source.metric, POLICY_METRICS, fallback.metric),
    operator: enumValue(source.operator, POLICY_OPERATORS, fallback.operator),
    threshold: nonNegativeNumber(source.threshold, fallback.threshold),
    unit: enumValue(source.unit, POLICY_UNITS, fallback.unit),
    action: enumValue(source.action, POLICY_ACTIONS, fallback.action),
    intensity: enumValue(source.intensity, POLICY_INTENSITIES, fallback.intensity),
    cancellationProbability: normalizeProbability(source.cancellationProbability ?? fallback.cancellationProbability),
    untilOperator: enumValue(source.untilOperator, POLICY_OPERATORS, fallback.untilOperator),
    untilThreshold: nonNegativeNumber(source.untilThreshold, fallback.untilThreshold),
    untilUnit: enumValue(source.untilUnit, POLICY_UNITS, fallback.untilUnit)
  }
}

function testCondition(policy, context, condition) {
  const metric = metricValue(policy.metric, context.stats)
  const threshold = condition.unit === 'percentPopulation'
    ? context.population * condition.threshold / 100
    : condition.threshold

  if (condition.operator === '>=') {
    return metric >= threshold
  }

  return metric <= threshold
}

function metricValue(metric, stats) {
  if (metric === 'activeCases') {
    return stats.exposed + stats.infectious
  }

  return stats[metric.replace('Cases', '')] || 0
}

function getInfectionProbabilityMultiplier(policy) {
  if (!POLICY_TRANSMISSION_ACTIONS.includes(policy.action)) {
    return 1
  }

  const multiplier = MASK_INFECTION_PROBABILITY_MULTIPLIERS[policy.intensity]

  return normalizeProbability(multiplier ?? 1)
}

function normalizeStats(stats = {}) {
  return {
    susceptible: nonNegativeInteger(stats.susceptible),
    exposed: nonNegativeInteger(stats.exposed),
    infectious: nonNegativeInteger(stats.infectious),
    recovered: nonNegativeInteger(stats.recovered)
  }
}

function enumValue(value, options, fallback) {
  const normalized = String(value || '')

  return options.includes(normalized) ? normalized : fallback
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value)

  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function nonNegativeInteger(value) {
  const number = Math.round(Number(value))

  return Number.isFinite(number) && number >= 0 ? number : 0
}

function normalizeProbability(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.min(Math.max(number, 0), 1)
}

function probabilityKey(value) {
  return Number(normalizeProbability(value).toFixed(4)).toString()
}
