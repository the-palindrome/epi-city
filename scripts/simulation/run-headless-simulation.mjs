#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { HEADLESS_EVENT_TYPES, runHeadlessSimulation } from '../../src/headless/simulation.js'
import { createProgressBar } from './progress-bar.mjs'

function printUsage() {
  console.log(`Usage:
  node scripts/simulation/run-headless-simulation.mjs --config ./scripts/simulation/headless-run-config.example.json --world ./scripts/simulation/epi-city-world.json --output ./tmp/epi-city-results.json [options]

Required:
  --config, -c              Path to headless run config JSON
  --world, -w               Generated world JSON path

Options:
  --output, -o              Output results JSON path (default: ./tmp/epi-city-results.json)
  --duration-days <number>  Override run duration in simulation days
  --duration-hours <number> Override run duration in simulation hours
  --duration-seconds <num>  Override run duration in simulation seconds
  --step <number>           Override run step in simulation seconds
  --events <list>           Export only these event types, comma-separated; repeatable
  --omit-events <list>      Omit these event types from export, comma-separated; repeatable
  --help, -h                Show this help

Event types:
  ${HEADLESS_EVENT_TYPES.join(', ')}
`)
}

function parseArgs(argv) {
  const args = {
    configPath: null,
    worldPath: null,
    output: path.resolve('tmp', 'epi-city-results.json'),
    overrides: {},
    eventFilter: {
      events: null,
      omitEvents: null
    },
    help: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    switch (arg) {
      case '--help':
      case '-h':
        args.help = true
        break
      case '--config':
      case '-c':
        args.configPath = next
        index += 1
        break
      case '--world':
      case '-w':
        args.worldPath = path.resolve(next)
        index += 1
        break
      case '--output':
      case '-o':
        args.output = path.resolve(next)
        index += 1
        break
      case '--duration-days':
        args.overrides.durationDays = positiveNumber(next, '--duration-days')
        index += 1
        break
      case '--duration-hours':
        args.overrides.durationHours = positiveNumber(next, '--duration-hours')
        index += 1
        break
      case '--duration-seconds':
        args.overrides.durationSeconds = positiveNumber(next, '--duration-seconds')
        index += 1
        break
      case '--step':
        args.overrides.stepSeconds = positiveNumber(next, '--step')
        index += 1
        break
      case '--events':
        args.eventFilter.events = appendEventTypeList(args.eventFilter.events, next, '--events')
        index += 1
        break
      case '--omit-events':
        args.eventFilter.omitEvents = appendEventTypeList(args.eventFilter.omitEvents, next, '--omit-events')
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!args.help && !args.configPath) {
    throw new Error('Missing required --config argument.')
  }

  if (!args.help && !args.worldPath) {
    throw new Error('Missing required --world argument.')
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let progress = null

  if (args.help) {
    printUsage()
    return
  }

  try {
    progress = createProgressBar({ label: 'Headless simulation' })
    progress.start('Reading config')

    const config = JSON.parse(await fs.readFile(path.resolve(args.configPath), 'utf8'))
    const results = await runHeadlessSimulation(config, {
      worldPath: args.worldPath,
      overrides: args.overrides,
      eventFilter: args.eventFilter,
      onProgress: ({ progress: value, message }) => progress.update(value * 0.95, message)
    })

    progress.update(0.98, 'Writing results')
    await fs.mkdir(path.dirname(args.output), { recursive: true })
    await fs.writeFile(args.output, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
    progress.finish('Results written')
    console.log(`Results written to ${args.output}`)
  } catch (error) {
    progress?.fail('Failed')
    throw error
  }
}

function positiveNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }

  return number
}

function appendEventTypeList(existing, value, label) {
  const nextValues = parseEventTypeList(value, label)

  return existing ? existing.concat(nextValues) : nextValues
}

function parseEventTypeList(value, label) {
  if (value == null || String(value).startsWith('--')) {
    throw new Error(`${label} requires a comma-separated event type list.`)
  }

  const values = String(value)
    .split(',')
    .map((eventType) => eventType.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error(`${label} requires at least one event type.`)
  }

  return values
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
