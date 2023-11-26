const CONTROLLER_SIGN_TEXT = 'https://github.com/ELynx/Cornered_Hamster'

module.exports.loop = function () {
  activateSafeModeIfAttacked()
  controlCreeps()
  performAutobuild()
  generatePixel()
  clearMemory()
}

const activateSafeModeIfAttacked = function () {
  if (Game.time % 100 === 0) {
    console.log('TODO parse room history and detect attacks')
  }
}

const controlCreeps = function () {
  for (const flagName in Game.flags) {
    if (flagName === 'savePlan') continue
    work(getCreepByFlagName(flagName))
  }
}

const work = function (creep) {
  if (creep === undefined) return ERR_INVALID_TARGET

  creep.__work__ = creep.getActiveBodyparts(WORK)

  signController(creep)
  grabEnergy(creep)
  upgradeController(creep)
  restock(creep)
  repair(creep)
  build(creep)
  harvest(creep)
}

const signController = function (creep) {
  const target = creep.room.controller

  if (target.__signed__) {
    return OK
  }

  let rc = ERR_NOT_IN_RANGE

  if (target.pos.isNearTo(creep)) {
    rc = OK // do not bother with all if-else

    if (target.sign) {
      if (target.sign.username !== SYSTEM_USERNAME) {
        if (target.sign.text !== CONTROLLER_SIGN_TEXT || target.sign.username !== creep.owner.username) {
          // this has potential to loop over and over when text sanitation or uncaught forced marker is there
          console.log('Controller signature was ' + target.sign.text)
          console.log('Controller signature set ' + CONTROLLER_SIGN_TEXT)
          rc = creep.signController(target, CONTROLLER_SIGN_TEXT)
          console.log('Result is ' + rc)
        }
      }
    } else {
      rc = creep.signController(target, CONTROLLER_SIGN_TEXT)
    }
  }

  if (rc === OK) {
    target.__signed__ = true
  }

  return rc
}

const grabEnergy = function (creep) {
  const targets = getGrabTargets(creep.room, RESOURCE_ENERGY)

  let didWithdraw = false
  let didPickup = false

  for (const target of targets) {
    const from = target[target.type]

    if (!from.pos.isNearTo(creep)) continue

    if ((didWithdraw === false) && (target.type === LOOK_TOMBSTONES || target.type === LOOK_RUINS)) {
      const rc = creep.withdraw(from, RESOURCE_ENERGY)
      if (rc === OK) {
        didWithdraw = true
      }
    }

    if (didPickup === false && target.type === LOOK_RESOURCES) {
      const rc = creep.pickup(from)
      if (rc === OK) {
        didPickup = true
      }
    }

    if (didWithdraw && didPickup) break
  }

  if (didWithdraw || didPickup) return OK

  return ERR_NOT_FOUND
}

const upgradeController = function (creep) {
  const target = creep.room.controller

  if (target.pos.inRangeTo(creep, 3)) {
    return creep.upgradeController(target)
  }

  return ERR_NOT_IN_RANGE
}

const restock = function (creep) {
  const targets = creep.room.find(FIND_STRUCTURES)

  const withEnergyDemand = _.filter(targets, x => (x.store && x.store.getFreeCapacity(RESOURCE_ENERGY) > 0))

  const inRange = _.filter(withEnergyDemand, x => x.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  return creep.transfer(_.sample(inRange), RESOURCE_ENERGY)
}

const repair = function (creep) {
  if (creep.__pipeline_1__ && creep.__pipeline_1__ > 4) {
    return ERR_BUSY
  }

  const gateRc = creepXenergyXgate(creep, REPAIR_POWER * REPAIR_COST)
  if (gateRc !== OK) {
    return gateRc
  }

  const targets = getRepairTargets(creep.room)

  const inRange = _.filter(targets, x => x.pos.inRangeTo(creep, 3))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.repair(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 4
  }

  return rc
}

const build = function (creep) {
  if (creep.__pipeline_1__ && creep.__pipeline_1__ > 3) {
    return ERR_BUSY
  }

  const gateRc = creepXenergyXgate(creep, BUILD_POWER)
  if (gateRc !== OK) {
    return gateRc
  }

  const targets = creep.room.find(FIND_CONSTRUCTION_SITES)

  const inRange = _.filter(targets, x => x.pos.inRangeTo(creep, 3))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.build(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 3
  }

  return rc
}

const harvest = function (creep) {
  if (creep.__pipeline_1__ && creep.__pipeline_1__ > 1) {
    return ERR_BUSY
  }

  const targets = creep.room.find(FIND_SOURCES_ACTIVE)

  const inRange = _.filter(targets, x => x.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.harvest(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 1
  }

  return rc
}

const getCreepByFlagName = function (flagName) {
  const flag = Game.flags[flagName]
  if (flag === undefined) {
    return undefined
  }

  if (flag.room === undefined) {
    return undefined
  }

  return getCreep(flagName, flag.room, flag.pos.x, flag.pos.y)
}

const getCreep = function (creepName, room, x, y) {
  const gateRc = getCreepXgate(room, x, y)
  if (gateRc !== OK) {
    return undefined
  }

  const name1 = creepName
  const name2 = makeAlternativeName(creepName)

  maybeSpawnCreep(name1, name2, room, x, y)

  const creep1 = Game.creeps[name1]
  if (creep1 && !creep1.spawning) {
    return creep1
  }

  const creep2 = Game.creeps[name2]
  if (creep2 && !creep2.spawning) {
    return creep2
  }

  return undefined
}

const getCreepXgate = function (room, x, y) {
  const terrain = room.getTerrain()
  const atXY = terrain.get(x, y)

  // do not spawn into wall
  if (atXY === TERRAIN_MASK_WALL) {
    const structures = room.find(FIND_STRUCTURES)
    for (const structure of structures) {
      if (structure.pos.x === x && structure.pos.y === y) {
        if (structure.structureType === STRUCTURE_ROAD) {
          return OK
        }
      }
    }

    return ERR_BUSY
  }

  return OK
}

const getGrabTargets = function (room, what) {
  if (room.__grab_target_cache__ && room.__grab_target_cache__[what]) {
    return room.__grab_target_cache__[what]
  }

  const tombstones = room.find(FIND_TOMBSTONES)
  const ruins = room.find(FIND_RUINS)
  const resources = room.find(FIND_DROPPED_RESOURCES)

  const targets = []

  for (const tombstone of tombstones) {
    if (tombstone.store.getUsedCapacity(what) > 0) {
      targets.push(
        {
          type: LOOK_TOMBSTONES,
          [LOOK_TOMBSTONES]: tombstone
        }
      )
    }
  }

  for (const ruin of ruins) {
    if (ruin.store.getUsedCapacity(what) > 0) {
      targets.push(
        {
          type: LOOK_RUINS,
          [LOOK_RUINS]: ruin
        }
      )
    }
  }

  for (const resource of resources) {
    if (resource.resourceType === what && resource.amount > 0) {
      targets.push(
        {
          type: LOOK_RESOURCES,
          [LOOK_RESOURCES]: resource
        }
      )
    }
  }

  if (room.__grab_target_cache__ === undefined) {
    room.__grab_target_cache__ = { }
  }

  return (room.__grab_target_cache__[what] = targets)
}

const creepXenergyXgate = function (creep, intentPower) {
  // how much (max) energy intent will spend
  const energyToPower = creep.__work__ * intentPower
  // upgrade controller is attempted every tick, and does not interfere with pipeline 1
  // keep enough energy to perform upgrade + intent this tick and upgrade + harvest next
  const energySpentOnUpgradeController = creep.__work__ * UPGRADE_CONTROLLER_POWER * 2
  // keep in mind that some power levels are not reachable
  const energyMax = creep.store.getCapacity()
  // do not fire intent below this level
  const energyThreshold = Math.min(energyToPower + energySpentOnUpgradeController, energyMax)

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) < energyThreshold) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  return OK
}

const getRepairTargets = function (room) {
  if (room.__repair_target_cache__) {
    return room.__repair_target_cache__
  }

  // if there is construction to be done, do not over-build ramps, walls and roads
  // 30000 is two decays of road on the wall
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES)
  const hitsThreshold = constructionSites.length > 0 ? 30000 : Number.MAX_SAFE_INTEGER

  const structures = room.find(FIND_STRUCTURES)

  const canBeRepaired = _.filter(structures, x => (CONSTRUCTION_COST[x.structureType] && x.hits && x.hitsMax && x.hits < x.hitsMax && x.hits < hitsThreshold))
  const mineOrNeutral = _.filter(canBeRepaired, x => (x.my || true))

  return (room.__repair_target_cache__ = mineOrNeutral)
}

const makeAlternativeName = function (name) {
  const alternativeName = name.replaceAll('a', 'ä').replaceAll('o', 'ö').replaceAll('u', 'ü').replaceAll('e', 'ё')

  if (alternativeName === name) {
    return name + '_twin'
  } else {
    return alternativeName
  }
}

const maybeSpawnCreep = function (name1, name2, room, x, y) {
  // if something is already spawning
  const creep1 = Game.creeps[name1]
  if (creep1 && creep1.spawning) {
    return OK
  }

  // if something is already spawning
  const creep2 = Game.creeps[name2]
  if (creep2 && creep2.spawning) {
    return OK
  }

  // both present and not spawning, error state
  if (creep1 && creep2) {
    return ERR_BUSY
  }

  // one of them has to be undefined
  // both can be undefined
  const creep = creep1 || creep2

  // see if body is possible
  const body = makeBody(room)
  if (body.length === 0) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  // by default, give 1st name
  let creepName = name1
  const otherCreepName = name2

  // check if creep with enough life exists
  if (creep) {
    const ticksToSpawn = body.length * CREEP_SPAWN_TIME
    // experimentally tested to be this operator
    if (creep.ticksToLive >= ticksToSpawn) {
      return OK
    }

    // swap creep names
    if (creep.name === creepName) {
      creepName = otherCreepName
    }
  }

  const queue = []

  for (const spawnName in Game.spawns) {
    const spawn = Game.spawns[spawnName]

    if (spawn.room.name !== room.name) continue
    if (!spawn.pos.isNearTo(x, y)) continue

    queue.push(spawn)
  }

  if (queue.length === 0) {
    console.log('No spawn in room [' + room.name + '] found for creep [' + creepName + ']')
    return ERR_NOT_FOUND
  }

  for (const spawn of queue) {
    if (spawn.spawning) continue
    if (spawn.__spawned_this_tick__) continue

    const spawnDirection = spawn.pos.getDirectionTo(x, y)

    const spawnRc = spawn.spawnCreep(body, creepName, { directions: [spawnDirection] })
    if (spawnRc === OK) {
      spawn.__spawned_this_tick__ = true
      return OK
    }
  }

  return ERR_NOT_FOUND
}

const makeBody = function (room) {
  if (room.__make_body_cache__) {
    return room.__make_body_cache__
  }

  const body = [WORK, WORK, CARRY] // backup for 300 spawn trickle charge

  // if someone there to restock
  if (_.keys(Game.creeps).length > 0) {
    if (Game.time % 100 === 0) {
      console.log('TODO body economics')
    }
  }

  return (room.__make_body_cache__ = _.shuffle(body))
}

const performAutobuild = function () {
  const flag = Game.flags.savePlan
  if (flag) {
    if (flag.room) {
      flag.room.savePlan()
    }

    flag.remove()

    return
  }

  if (Game.time % 100 === 0) {
    for (const roomName in Game.rooms) {
      Game.rooms[roomName].buildFromPlan()
    }
  }
}

Room.prototype.savePlan = function () {
  const structures = this
    .find(FIND_STRUCTURES)
    .sort(
      function (s1, s2) {
        const index1 = (s1.pos.y + 1) * 100 + s1.pos.x
        const index2 = (s2.pos.y + 1) * 100 + s2.pos.x
        if (index1 === index2) return s1.structureType.localeCompare(s2.structureType)

        return index1 - index2
      }
    )

  let plan = ''
  for (const structure of structures) {
    const code = structure.encode()
    if (code === undefined) continue

    plan += code
  }

  if (plan === '') {
    plan = undefined
  }

  this.memory.plan = plan
}

Room.prototype.buildFromPlan = function () {
  const plan = this.memory.plan
  if (plan === undefined) return

  for (let i = 0; i < plan.length; ++i) {
    const code = plan.charCodeAt(i)
    const [position, structureType] = Structure.prototype.decode(code)
    if (structureType === undefined) continue

    this.createConstructionSite(position.x, position.y, structureType)
  }
}

const StructureTypeToIndex = {
  [STRUCTURE_WALL]: 0,
  [STRUCTURE_CONTAINER]: 1,
  [STRUCTURE_EXTENSION]: 2,
  [STRUCTURE_FACTORY]: 3,
  [STRUCTURE_LAB]: 4,
  [STRUCTURE_LINK]: 5,
  [STRUCTURE_NUKER]: 6,
  [STRUCTURE_OBSERVER]: 7,
  [STRUCTURE_POWER_SPAWN]: 8,
  [STRUCTURE_RAMPART]: 9,
  [STRUCTURE_ROAD]: 10,
  [STRUCTURE_SPAWN]: 11,
  [STRUCTURE_STORAGE]: 12,
  // there is nothing on index 13 aka 0b1101 because this lands into forbidden UTF-16
  [STRUCTURE_TERMINAL]: 14,
  [STRUCTURE_TOWER]: 15
}

const IndexToStructureType =
  [
    STRUCTURE_WALL,
    STRUCTURE_CONTAINER,
    STRUCTURE_EXTENSION,
    STRUCTURE_FACTORY,
    STRUCTURE_LAB,
    STRUCTURE_LINK,
    STRUCTURE_NUKER,
    STRUCTURE_OBSERVER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_RAMPART,
    STRUCTURE_ROAD,
    STRUCTURE_SPAWN,
    STRUCTURE_STORAGE,
    undefined, // there is nothing on index 13 aka 0b1101 because this lands into forbidden UTF-16
    STRUCTURE_TERMINAL,
    STRUCTURE_TOWER
  ]

Structure.prototype.encode = function () {
  // protection from area walls
  if (this.hits === undefined || this.hitsMax === undefined) return undefined

  const index = StructureTypeToIndex[this.structureType]
  if (index === undefined) return undefined

  const x = this.pos.x
  const y = this.pos.y

  // idea taken from screeps packrat
  const code = (index << 12) | (x << 6) | y

  return String.fromCharCode(code)
}

Structure.prototype.decode = function (code) {
  const index = (code & 0b1111000000000000) >> 12
  const xxxxx = (code & 0b0000111111000000) >> 6
  const yyyyyy = code & 0b0000000000111111

  const structureType = IndexToStructureType[index]

  return [{ x: xxxxx, y: yyyyyy }, structureType]
}

const generatePixel = function () {
  if (Game.rooms.sim === undefined) {
    return Game.cpu.generatePixel()
  }
}

const clearMemory = function () {
  Memory.creeps = undefined
  Memory.spawns = undefined
  Memory.flags = undefined

  for (const roomName in Memory.rooms) {
    if (!Game.rooms[roomName]) {
      Memory.rooms[roomName] = undefined
    }
  }
}
