import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/*.test.js'],
    maxWorkers: 1,
    pool: 'threads'
  }
})
