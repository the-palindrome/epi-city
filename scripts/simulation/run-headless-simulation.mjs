#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runHeadlessSimulation } from '../src/headless/simulation.js'

function printUsage() {
  console.log(`Usage:
  node scripts/run-headless-simulation.mjs --config ./scripts/headless-run.example.json --output ./tmp/epi-city-results.json [options]

Required:
  --config, -c              Path to headless run config JSON

Options:
  --world, -w               Optional generated world JSON path
  --output, -o              Output results JSON path (default: ./tmp/epi-city-results.json)
  --duration-days <number>  Override run duration in simulation days
  --duration-hours <number> Override run duration in simulation hours
  --duration-seconds <num>  Override run duration in simulation seconds
  --step <number>           Override run step in simulation seconds
  --help, -h                Show this help
`)
}

function parseArgs(argv) {
  const args = {
    configPath: null,
    worldPath: null,
    output: path.resolve('tmp', 'epi-city-results.json'),
    overrides: {},
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
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!args.help && !args.configPath) {
    throw new Error('Missing required --config argument.')
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printUsage()
    return
  }

  const config = JSON.parse(await fs.readFile(path.resolve(args.configPath), 'utf8'))
  const results = await runHeadlessSimulation(config, {
    worldPath: args.worldPath,
    overrides: args.overrides
  })

  await fs.mkdir(path.dirname(args.output), { recursive: true })
  await fs.writeFile(args.output, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  console.log(`Results written to ${args.output}`)
}

function positiveNumber(value, label) {
  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }

  return number
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
