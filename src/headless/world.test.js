import { describe, expect, it } from 'vitest'
import { createHeadlessWorldFile, HEADLESS_WORLD_VERSION, normalizeHeadlessWorld } from './world.js'

describe('headless world files', () => {
  it('generates entity snapshots and social groups without config or initial SEIR state', async () => {
    const world = await createHeadlessWorldFile({
      seed: { enabled: true, value: 'world-test' },
      population: { npcCount: 200, carCount: 0 }
    })
    const familyMemberIds = new Set(world.families.flatMap((family) => family.memberIds))
    const classStudentIds = new Set(world.classes.flatMap((schoolClass) => schoolClass.studentIds))
    const officeWorkerIds = new Set(world.offices.flatMap((office) => office.workerIds))
    const buildingIds = new Set(world.buildings.map((building) => building.id))
    const schoolNpcIds = world.npcs.filter((npc) => npc.schoolBuildingId).map((npc) => npc.id).sort()
    const workNpcIds = world.npcs.filter((npc) => npc.workBuildingId).map((npc) => npc.id).sort()

    expect(world.version).toBe(HEADLESS_WORLD_VERSION)
    expect(world.npcs).toHaveLength(200)
    expect(world.cars).toHaveLength(0)
    expect(world.buildings.length).toBeGreaterThan(0)
    expect(world.buildings[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      types: expect.any(Array),
      entrance: expect.any(Object),
      spans: expect.any(Array)
    }))
    expect(world.npcs.every((npc) => buildingIds.has(npc.homeBuildingId))).toBe(true)
    expect(world.families.length).toBeGreaterThan(0)
    expect(familyMemberIds.size).toBe(world.npcs.length)
    expect(world.npcs.every((npc) => npc.familyId && familyMemberIds.has(npc.id))).toBe(true)
    expect([...classStudentIds].sort()).toEqual(schoolNpcIds)
    expect([...officeWorkerIds].sort()).toEqual(workNpcIds)
    expect(world.classes.every((schoolClass) => schoolClass.size === schoolClass.studentIds.length)).toBe(true)
    expect(world.offices.every((office) => office.size === office.workerIds.length)).toBe(true)
    expect(world.npcs.every((npc) => (
      !npc.locationState?.indoorTargetState ||
      npc.locationState.indoorTargetState.type === 'lobby' ||
      npc.locationState.indoorTargetState.type === 'main' ||
      (npc.locationState.indoorTargetState.type === 'family' && npc.locationState.indoorTargetState.id === npc.familyId) ||
      (npc.locationState.indoorTargetState.type === 'class' && npc.locationState.indoorTargetState.id === npc.classId) ||
      (npc.locationState.indoorTargetState.type === 'office' && npc.locationState.indoorTargetState.id === npc.officeId)
    ))).toBe(true)
    expect(world.config).toBeUndefined()
    expect(world.initialSeir).toBeUndefined()
  })

  it('generates deterministic school class and office groups for the same world seed', async () => {
    const config = {
      seed: { enabled: true, value: 'world-group-seed' },
      population: { npcCount: 200, carCount: 0 }
    }
    const first = await createHeadlessWorldFile(config)
    const second = await createHeadlessWorldFile(config)

    expect(first.families).toEqual(second.families)
    expect(first.classes).toEqual(second.classes)
    expect(first.offices).toEqual(second.offices)
    expect(first.buildings).toEqual(second.buildings)
    expect(first.npcs.map((npc) => ({
      id: npc.id,
      familyId: npc.familyId,
      classId: npc.classId,
      officeId: npc.officeId
    }))).toEqual(second.npcs.map((npc) => ({
      id: npc.id,
      familyId: npc.familyId,
      classId: npc.classId,
      officeId: npc.officeId
    })))
  })

  it('normalizes legacy world fields away from supplied world files', () => {
    const world = normalizeHeadlessWorld({
      npcs: [{ id: 'npc_0', index: 0 }],
      config: { population: { npcCount: 1000, carCount: 200 } },
      initialSeir: {
        infectedNpcIds: ['npc_0'],
        inoculatedNpcIds: ['npc_0']
      }
    })

    expect(world.npcs).toHaveLength(1)
    expect(world.buildings).toEqual([])
    expect(world.families).toEqual([])
    expect(world.classes).toEqual([])
    expect(world.offices).toEqual([])
    expect(world.config).toBeUndefined()
    expect(world.initialSeir).toBeUndefined()
  })

  it('normalizes group membership and rejects unknown group NPC ids', () => {
    const world = normalizeHeadlessWorld({
      npcs: [
        { id: 'npc_0', index: 0, age: 12 },
        { id: 'npc_1', index: 1, age: 40 }
      ],
      families: [
        { id: 'family_0', type: 'single', memberIds: ['npc_0'], childIds: ['npc_0'] },
        { id: 'family_1', type: 'single', memberIds: ['npc_1'], adultIds: ['npc_1'] }
      ],
      classes: [
        { id: 'class_0', schoolBuildingId: 'school', studentIds: ['npc_0'] }
      ],
      offices: [
        { id: 'office_0', workBuildingId: 'work', workerIds: ['npc_1'] }
      ]
    })

    expect(world.npcs[0]).toMatchObject({
      familyId: 'family_0',
      classId: 'class_0',
      officeId: null
    })
    expect(world.npcs[1]).toMatchObject({
      familyId: 'family_1',
      classId: null,
      officeId: 'office_0'
    })

    expect(() => normalizeHeadlessWorld({
      npcs: [{ id: 'npc_0', index: 0 }],
      families: [{ id: 'family_0', memberIds: ['npc_1'] }]
    })).toThrow(/unknown NPC id/)
  })

  it('normalizes buildings and rejects unknown building references when buildings are supplied', () => {
    const world = normalizeHeadlessWorld({
      buildings: [
        {
          id: 'home',
          types: ['residential', 'residential'],
          entrance: { x: 1, y: 2 },
          spans: [[2, 1, 3]]
        }
      ],
      npcs: [
        { id: 'npc_0', index: 0, homeBuildingId: 'home' }
      ],
      families: [
        { id: 'family_0', homeBuildingId: 'home', memberIds: ['npc_0'] }
      ]
    })

    expect(world.buildings).toEqual([
      {
        id: 'home',
        types: ['residential'],
        entrance: { x: 1, y: 2 },
        spans: [[2, 1, 3]]
      }
    ])

    expect(() => normalizeHeadlessWorld({
      buildings: [
        {
          id: 'home',
          types: ['residential'],
          entrance: { x: 1, y: 2 },
          spans: [[2, 1, 3]]
        }
      ],
      npcs: [
        { id: 'npc_0', index: 0, homeBuildingId: 'missing' }
      ]
    })).toThrow(/unknown building id/)
  })
})
