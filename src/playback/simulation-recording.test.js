import { describe, expect, it } from 'vitest'
import {
  createReplayScript,
  createSimulationRecordingFile,
  normalizeSimulationRecordingFile,
  validateReplayScript
} from './simulation-recording.js'

function createRecording() {
  return {
    durationSeconds: 20,
    sampleIntervalSeconds: 10,
    stepSeconds: 2,
    parameters: {
      seedEnabled: true,
      seed: 'recording-test',
      npcCount: 1,
      carCount: 1
    },
    snapshots: [
      {
        simulationSeconds: 0,
        camera: { x: 1, y: 2, zoom: 0.5 },
        npcs: [{ id: 0, x: 1, y: 2 }],
        cars: [{ id: 0, x: 3, y: 4 }]
      },
      {
        simulationSeconds: 20,
        camera: { x: 1, y: 2, zoom: 0.5 },
        npcs: [{ id: 0, x: 5, y: 6 }],
        cars: [{ id: 0, x: 7, y: 8 }]
      }
    ]
  }
}

function createScript(overrides = {}) {
  return {
    simulation: {
      duration: 20,
      parameters: {
        seedEnabled: true,
        seed: 'recording-test',
        npcCount: 1,
        carCount: 1
      },
      ...(overrides.simulation || {})
    },
    render: { duration: 4 },
    script: overrides.script || [
      { at: 0, action: 'playback', from: 0, to: 20, duration: 4 },
      { at: 0, action: 'setCamera', zoom: 0.5 }
    ]
  }
}

describe('simulation recording files', () => {
  it('wraps a normalized script and recording for replay', () => {
    const file = createSimulationRecordingFile({
      script: createScript(),
      recording: createRecording(),
      createdAt: '2026-05-12T00:00:00.000Z'
    })

    expect(file.format).toBe('epi-city-simulation-recording')
    expect(file.version).toBe(1)
    expect(file.summary).toMatchObject({
      duration: 4,
      recordingDuration: 20,
      snapshotCount: 2
    })

    const normalized = normalizeSimulationRecordingFile(file)

    expect(normalized.script.render.durationSeconds).toBe(4)
    expect(normalized.recording.snapshots).toHaveLength(2)
  })

  it('creates a replay script from a recording and render override', () => {
    const file = createSimulationRecordingFile({
      script: createScript(),
      recording: createRecording()
    })
    const replayScript = createReplayScript(file, {
      render: { duration: 2 },
      script: [
        { at: 0, action: 'playback', from: 0, to: 20, duration: 2 },
        { at: 0, action: 'call', method: 'setEntityRenderMode', args: ['sprite'] }
      ]
    })

    expect(replayScript.render.durationSeconds).toBe(2)
    expect(replayScript.simulation.durationSeconds).toBe(20)
    expect(replayScript.simulation.actions).toEqual([])
    expect(replayScript.simulation.parameters).toMatchObject({
      npcCount: 1,
      carCount: 1
    })
  })

  it('allows baked simulation actions from the recording script but strips them during replay', () => {
    const file = createSimulationRecordingFile({
      script: createScript({
        simulation: {
          actions: [{ at: 1, action: 'setNpcPosition', id: 0, position: { x: 4, y: 5 } }]
        }
      }),
      recording: createRecording()
    })
    const replayScript = createReplayScript(file)

    expect(replayScript.simulation.actions).toEqual([])
  })

  it('rejects replay scripts that mutate baked simulation state', () => {
    expect(() => validateReplayScript(createScript({
      simulation: {
        actions: [{ at: 1, action: 'setNpcPosition', id: 0, position: { x: 4, y: 5 } }]
      }
    }))).toThrow(/simulation\.actions/)

    expect(() => validateReplayScript(createScript({
      script: [{ at: 0, action: 'moveNpc', id: 0, to: { x: 4, y: 5 }, duration: 1 }]
    }))).toThrow(/entity positions are baked/)

    expect(() => validateReplayScript(createScript({
      script: [{ at: 0, action: 'call', method: 'setNpcCount', args: [2] }]
    }))).toThrow(/may change baked simulation state/)

    expect(() => validateReplayScript(createScript({
      script: [{ at: 0, action: 'surpriseAction' }]
    }))).toThrow(/unknown render action/)
  })
})
