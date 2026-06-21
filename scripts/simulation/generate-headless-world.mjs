#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHeadlessWorldFile } from '../../src/headless/world.js'

function printUsage() {
  console.log(`Usage:
  node scripts/simulation/generate-headless-world.mjs --config ./scripts/simulation/headless-world-config.example.json --output ./scripts/simulation/epi-city-world.json

Required:
  --config, -c   Path to headless world config JSON

Options:
  --output, -o   Output world JSON path (default: ./scripts/simulation/epi-city-world.json)
  --help, -h     Show this help
`)
}

function parseArgs(argv) {
  const args = {
    configPath: null,
    output: path.resolve('scripts', 'simulation', 'epi-city-world.json'),
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
      case '--output':
      case '-o':
        args.output = path.resolve(next)
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
  const world = await createHeadlessWorldFile(config)

  await fs.mkdir(path.dirname(args.output), { recursive: true })
  await fs.writeFile(args.output, `${JSON.stringify(world, null, 2)}\n`, 'utf8')
  console.log(`World written to ${args.output}`)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
