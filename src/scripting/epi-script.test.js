import { describe, expect, it } from 'vitest'
import {
  easingValue,
  getScriptDuration,
  getTimelineActionsAt,
  interpolateNumber,
  normalizeEpiScript
} from './epi-script.js'

describe('epi script normalization', () => {
  it('normalizes object input with simulation aliases and timeline ordering', () => {
    const script = normalizeEpiScript({
      simulation: {
        durationHours: 0.5,
        sampleInterval: 0.25,
        step: 0.125,
        parameters: { population: 12 },
        actions: [
          { at: 3, action: 'callApi', endpoint: '/tick' },
          { at: 1, action: 'teleportNpc', npcId: 'n1' },
          { at: 2, action: 'moveCar', carId: 'c1' }
        ]
      },
      cameraStart: { x: 10, y: 20, zoom: 2 },
      actions: [
        { at: 4, index: 2, action: 'playSimulation', duration: 1 },
        { at: -2, action: 'cameraSet' },
        { at: 4, index: 1, action: 'panCamera', duration: 3 }
      ]
    })

    expect(script).toEqual({
      simulation: {
        durationSeconds: 1800,
        sampleIntervalSeconds: 0.25,
        stepSeconds: 0.125,
        parameters: { population: 12 },
        actions: [
          { at: 1, action: 'setNpcPosition', npcId: 'n1' },
          { at: 2, action: 'setCarPosition', carId: 'c1' },
          { at: 3, action: 'call', endpoint: '/tick' }
        ]
      },
      render: { durationSeconds: 7 },
      cameraStart: { x: 10, y: 20, zoom: 2 },
      actions: [
        { at: 0, action: 'setCamera' },
        { at: 4, index: 1, action: 'moveCamera', duration: 3 },
        { at: 4, index: 2, action: 'playback', duration: 1 }
      ]
    })
  })

  it('accepts a JSON string input and explicit render duration', () => {
    const script = normalizeEpiScript(JSON.stringify({
      simulation: { duration: 12, sampleIntervalSeconds: 2, stepSeconds: 1 },
      render: { durationSeconds: 9 },
      script: [{ at: 1, action: 'apiCall' }]
    }))

    expect(script.simulation.durationSeconds).toBe(12)
    expect(script.render.durationSeconds).toBe(9)
    expect(script.actions[0].action).toBe('call')
  })

  it('rejects ambiguous script/action fields', () => {
    expect(() => normalizeEpiScript({
      simulation: { durationSeconds: 1 },
      script: [],
      actions: []
    })).toThrow(/either "script" or "actions"/)
  })

  it('accepts an action array and uses the default render duration when no action has an end time', () => {
    const script = normalizeEpiScript([
      { at: 0, action: 'followNpc' },
      { at: 0, action: 'followCar' }
    ])

    expect(script.render.durationSeconds).toBe(10)
    expect(script.actions.map((action) => action.action)).toEqual(['followEntity', 'followEntity'])
    expect(script.actions.map((action) => action.kind)).toEqual(['npc', 'car'])
  })

  it('canonicalizes all timeline action aliases', () => {
    const actions = [
      ['setCamera', 'setCamera'],
      ['cameraSet', 'setCamera'],
      ['moveCamera', 'moveCamera'],
      ['cameraMove', 'moveCamera'],
      ['panCamera', 'moveCamera'],
      ['playback', 'playback'],
      ['playSimulation', 'playback'],
      ['call', 'call'],
      ['apiCall', 'call'],
      ['callApi', 'call'],
      ['followEntity', 'followEntity'],
      ['followNpc', 'followEntity'],
      ['followCar', 'followEntity'],
      ['setNpcPosition', 'setNpcPosition'],
      ['teleportNpc', 'setNpcPosition'],
      ['moveNpc', 'moveNpc'],
      ['setCarPosition', 'setCarPosition'],
      ['teleportCar', 'setCarPosition'],
      ['moveCar', 'moveCar']
    ]

    const script = normalizeEpiScript({
      simulation: { durationSeconds: 1 },
      actions: actions.map(([action], index) => ({ at: index + 1, action }))
    })

    expect(script.actions.map((action) => action.action))
      .toEqual(actions.map(([, canonical]) => canonical))
  })

  it('rejects non-positive durations and intervals', () => {
    expect(() => normalizeEpiScript({ simulation: { durationSeconds: 0 } }))
      .toThrow(/simulation\.durationSeconds must be positive/)
    expect(() => normalizeEpiScript({ simulation: { durationSeconds: 1, sampleInterval: 0 } }))
      .toThrow(/simulation\.sampleIntervalSeconds must be positive/)
    expect(() => normalizeEpiScript({ simulation: { durationSeconds: 1, step: -1 } }))
      .toThrow(/simulation\.stepSeconds must be positive/)
    expect(() => normalizeEpiScript({
      simulation: { durationSeconds: 1 },
      actions: [{ at: 1, action: 'call', duration: 0 }]
    })).toThrow(/actions\[0\]\.duration must be positive/)
  })

  it('defaults missing simulation duration and rejects bad input shapes', () => {
    expect(normalizeEpiScript({}).simulation.durationSeconds).toBe(10)
    expect(() => normalizeEpiScript('nope')).toThrow(/Invalid Epi script JSON/)
    expect(() => normalizeEpiScript(12)).toThrow(/JSON string, action array, or object/)
    expect(() => normalizeEpiScript({
      simulation: { durationSeconds: 1 },
      actions: [{ at: 0, action: '' }]
    })).toThrow(/actions\[0\]\.action must be a non-empty string/)
  })
})

describe('epi script timeline helpers', () => {
  it('returns actions active at a point in time', () => {
    const actions = normalizeEpiScript({
      simulation: { durationSeconds: 20 },
      actions: [
        { at: 2, action: 'call' },
        { at: 3, action: 'moveCamera', duration: 4 },
        { at: 8, action: 'playback', duration: 2 }
      ]
    }).actions

    expect(getTimelineActionsAt(actions, 2).map((action) => action.action)).toEqual(['call'])
    expect(getTimelineActionsAt(actions, 5).map((action) => action.action)).toEqual(['moveCamera'])
    expect(getTimelineActionsAt(actions, 8).map((action) => action.action)).toEqual(['playback'])
  })

  it('reports the longest normalized script duration', () => {
    const script = normalizeEpiScript({
      simulation: { durationSeconds: 8 },
      render: { duration: 5 },
      actions: [{ at: 2, action: 'moveCamera', duration: 12 }]
    })

    expect(getScriptDuration(script)).toBe(14)
  })

  it('keeps simulation duration separate from render duration', () => {
    const script = normalizeEpiScript({
      simulation: { durationHours: 24 },
      render: { duration: 12 },
      actions: [{ at: 4, action: 'moveCamera', duration: 2 }]
    })

    expect(getScriptDuration(script)).toBe(12)
  })

  it('interpolates numbers with clamped time', () => {
    expect(interpolateNumber(10, 20, 0.25)).toBe(12.5)
    expect(interpolateNumber(10, 20, -1)).toBe(10)
    expect(interpolateNumber(10, 20, 2)).toBe(20)
  })

  it('evaluates supported easing functions', () => {
    expect(easingValue('linear', 0.5)).toBe(0.5)
    expect(easingValue('smooth', 0.5)).toBe(0.5)
    expect(easingValue('ease-in', 0.5)).toBe(0.25)
    expect(easingValue('ease-out', 0.5)).toBe(0.75)
    expect(easingValue('ease-in-out', 0.5)).toBe(0.5)
    expect(() => easingValue('bounce', 0.5)).toThrow(/Unknown easing/)
  })
})
