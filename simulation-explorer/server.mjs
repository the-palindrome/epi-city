#!/usr/bin/env node
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TOOL_DIR, '..')
const D3_BUNDLE_PATH = path.join(REPO_ROOT, 'node_modules', 'd3', 'dist', 'd3.min.js')
const DEFAULT_PORT = 5175
const START_PORT = Number(process.env.PORT || DEFAULT_PORT)
const MAX_PORT = 65535

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message })
}

async function sendFile(request, response, filePath, contentType) {
  try {
    const info = await stat(filePath)
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'cache-control': 'no-store'
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(filePath).pipe(response)
  } catch (error) {
    throw new HttpError(404, `Could not read ${displayPath(filePath)}: ${error.message}`)
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

  try {
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
      await sendFile(request, response, path.join(TOOL_DIR, 'index.html'), 'text/html; charset=utf-8')
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' })
      response.end()
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/vendor/d3.min.js') {
      await sendFile(request, response, D3_BUNDLE_PATH, 'text/javascript; charset=utf-8')
      return
    }

    sendError(response, 404, `Unknown route ${request.method} ${url.pathname}`)
  } catch (error) {
    const status = error.status || 500

    if (status >= 500) {
      console.error(error)
    }

    sendError(response, status, error.message)
  }
}

function listenOnAvailablePort(server, port) {
  const onError = (error) => {
    server.off('listening', onListening)

    if (error.code === 'EADDRINUSE' && Number.isInteger(port) && port > 0 && port < MAX_PORT) {
      const nextPort = port + 1
      console.warn(`Port ${port} is in use; trying ${nextPort}.`)
      listenOnAvailablePort(server, nextPort)
      return
    }

    throw error
  }

  const onListening = () => {
    server.off('error', onError)
    const address = server.address()
    const boundPort = address && typeof address === 'object' ? address.port : port

    console.log(`Simulation explorer running at http://localhost:${boundPort}`)
  }

  server.once('error', onError)
  server.once('listening', onListening)
  server.listen(port, '0.0.0.0')
}

function displayPath(filePath) {
  return path.isAbsolute(filePath) ? path.relative(REPO_ROOT, filePath) : filePath
}

listenOnAvailablePort(createServer(handleRequest), START_PORT)
