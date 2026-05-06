import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const sourceMapsDir = path.join(repoRoot, 'public', 'maps')

function sourceMapContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.json') {
    return 'application/json; charset=utf-8'
  }

  if (extension === '.webp') {
    return 'image/webp'
  }

  return 'application/octet-stream'
}

async function sendSourceMapFile(request, response, next) {
  if (!request.url || !['GET', 'HEAD'].includes(request.method || '')) {
    next()
    return
  }

  const url = new URL(request.url, 'http://localhost')

  if (!url.pathname.startsWith('/maps/')) {
    next()
    return
  }

  const requestedPath = decodeURIComponent(url.pathname.slice('/maps/'.length))
  const filePath = path.resolve(sourceMapsDir, requestedPath)
  const relativePath = path.relative(sourceMapsDir, filePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  let info

  try {
    info = await stat(filePath)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  if (!info.isFile()) {
    next()
    return
  }

  response.writeHead(200, {
    'content-type': sourceMapContentType(filePath),
    'content-length': info.size,
    'cache-control': 'no-store'
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function useSourceMapFiles(server) {
  server.middlewares.use((request, response, next) => {
    sendSourceMapFile(request, response, next).catch(next)
  })
}

function sourceMapsFromPublicPlugin() {
  return {
    name: 'source-maps-from-public',
    configureServer: useSourceMapFiles,
    configurePreviewServer: useSourceMapFiles
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [sourceMapsFromPublicPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
