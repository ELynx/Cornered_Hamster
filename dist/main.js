console.log('Code loaded')

const CONTROLLER_SIGN_TEXT = 'https://github.com/ELynx/Cornered_Hamster'
let forcedControllerSign = true // once in code load force the sign, it is visible on new world map

const ROOM_PLANS = {
  E56N59: {
    0: '룃', // spawn
    1: '룃', // spawn
    2: '룃⢂⣂⤂⥃⥄', // spawn + 5 extensions
    3: '룃⡂⢂⣂⤂⥃⥄', // spawn + 6 extensions
    4: '룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // spawn + 6 extensions + 3 containers + spawn rampart
    5: '룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // -//-
    6: '룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // -//-
    7: '룃뤂⢂⣂⥃⥄ᢃᤃᤄ飃餂飂', // mutate extension into spawn + spawn rampart, mutate extension into terminal + terminal rampart
    8: '뤂뢂뢃硂顂颂飂餂颃飃餃楃饃ꢄ䤄餄襄饄', // end build with 1 wall road
    9: '뤂뢂뢃硂顂颂飂餂颃飃餃楃饃ꢄ䤄餄襄饄ꢅ' // end build with 2 wall roads
  }
}

// fallback for simulation
if (Game.rooms.sim) {
  ROOM_PLANS.sim = ROOM_PLANS.E56N59
}

module.exports.loop = function () {
  processRoomEventLogs() // first because activates safe mode
  handleRoomStates() // second because set flags used in other code
  controlCreeps()
  performAutobuild()
  generatePixel()
  clearMemory()
}

const processRoomEventLogs = function () {
  for (const roomName in Game.rooms) {
    processRoomEventLog(Game.rooms[roomName])
  }
}

const handleRoomStates = function () {
  for (const roomName in Game.rooms) {
    handleRoomState(Game.rooms[roomName])
  }
}

const controlCreeps = function () {
  // TODO replace old spawn logic
  // to resolve potential softlocks
  const flagNames = _.shuffle(_.keys(Game.flags))
  for (const flagName of flagNames) {
    getCreepByFlagName(flagName)
  }

  // to resolve potential softlocks
  const creepNames = _.shuffle(_.keys(Game.creeps))
  for (const creepName of creepNames) {
    const creep = Game.creeps[creepName]
    if (creep.spawning) continue

    creep.__work__ = creep.getActiveBodyparts(WORK)
    creep.__legs__ = creep.getActiveBodyparts(MOVE)

    if (creep.__work__ > 0) {
      work(creep)
    }
  }
}

const work = function (creep) {
  signController(creep)
  getBoosted(creep)
  grabEnergy(creep)
  upgradeController(creep)
  restockEnergy(creep)
  repair(creep)
  build(creep)
  harvest(creep)
  dismantle(creep)
  cancelConstructionSites(creep)
  handleInvasion(creep)
  moveAround(creep)

  return OK
}

const signController = function (creep) {
  const target = creep.room.controller

  if (!target) {
    return ERR_NOT_FOUND
  }

  if (target.__signed__) {
    return OK
  }

  let rc = ERR_NOT_IN_RANGE

  if (target.pos.isNearTo(creep)) {
    rc = OK // do not bother with all if-else

    if (target.sign) {
      if (target.sign.username !== SYSTEM_USERNAME || forcedControllerSign) {
        if (target.sign.text !== CONTROLLER_SIGN_TEXT || target.sign.username !== creep.owner.username) {
          // this has potential to loop over and over when text sanitation or uncaught forced marker is there
          console.log(`Controller signature was ${target.sign.text}`)
          console.log(`Controller signature set ${CONTROLLER_SIGN_TEXT}`)
          rc = creep.signController(target, CONTROLLER_SIGN_TEXT)
          console.log(`Result is ${rc}`)

          if (target.sign.username === SYSTEM_USERNAME) {
            forcedControllerSign = false
          }
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

const getBoosted = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const structures = creep.room.find(FIND_STRUCTURES)

  const labs = _.filter(structures, s => s.structureType === STRUCTURE_LAB)

  const inRange = _.filter(labs, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  // keep doing it
  return _.sample(inRange).boostCreep(creep)
}

const grabEnergy = function (creep) {
  return grab(creep, RESOURCE_ENERGY)
}

const upgradeController = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const target = creep.room.controller

  if (!target) {
    return ERR_NOT_FOUND
  }

  if (target.pos.inRangeTo(creep, 3)) {
    return creep.upgradeController(target)
  }

  return ERR_NOT_IN_RANGE
}

const restockEnergy = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const targets = getRestockTargets(creep.room, RESOURCE_ENERGY)

  const inRange = _.filter(targets, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  return creep.transfer(_.sample(inRange), RESOURCE_ENERGY)
}

const repair = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  if (creep.__pipeline_1__ && creep.__pipeline_1__ > 4) {
    return ERR_BUSY
  }

  const gateRc = creepXenergyXgate(creep, REPAIR_POWER * REPAIR_COST)
  if (gateRc !== OK) {
    return gateRc
  }

  const targets = getRepairTargets(creep.room)

  const inRange = _.filter(targets, s => s.pos.inRangeTo(creep, 3))
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

  let targets = creep.room.find(FIND_CONSTRUCTION_SITES)

  if (creep.room.__no_spawn__) {
    targets = _.filter(targets, _.matchesProperty('structureType', STRUCTURE_SPAWN))
    targets = _.sortByOrder(targets, ['progress'], ['desc'])
    const target = _.first(targets)
    targets = target ? [target] : []
  }

  const inRange = _.filter(targets, s => s.pos.inRangeTo(creep, 3))
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

  const inRange = _.filter(targets, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.harvest(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 1
  }

  return rc
}

const dismantle = function (creep) {
  // last resort measure
  if (!creep.room.__no_spawn__) {
    return ERR_NOT_FOUND
  }

  // do not override other intents in pipeline, they are more useful
  if (creep.__pipeline_1__) {
    return ERR_BUSY
  }

  const targets = creep.room.find(FIND_STRUCTURES)

  const canBeDismantled = _.filter(targets, s => (CONSTRUCTION_COST[s.structureType] && s.hits && s.hitsMax))

  const inRange = _.filter(canBeDismantled, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.dismantle(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 5
  }

  return rc
}

const cancelConstructionSites = function (creep) {
  // last resort measure
  if (!creep.room.__no_spawn__) {
    return ERR_NOT_FOUND
  }

  const targets = creep.room.find(FIND_CONSTRUCTION_SITES)

  const canBeCancelled = _.filter(targets, s => s.structureType !== STRUCTURE_SPAWN)

  const inRange = _.filter(canBeCancelled, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  let cancelled = false
  for (const constructionSite of inRange) {
    // will potentially release some energy
    const rc = constructionSite.remove()
    cancelled = cancelled || rc === OK
  }

  return cancelled ? OK : ERR_BUSY
}

const handleInvasion = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_BUSY
  }

  if (creep.room.__invasion_npc__ && (creep.room.__can_fight__ === undefined)) {
    const structures = creep.room.find(FIND_STRUCTURES)

    const spawns = _.filter(
      structures,
      (s) => {
        if (s.structureType !== STRUCTURE_SPAWN) return false
        if (s.spawning || s.__spawned_this_tick__) return false
        return !s.__recycled_this_tick__
      }
    )

    const inRange = _.filter(spawns, s => s.pos.isNearTo(creep))

    for (const spawn of inRange) {
      // because Invader suicides when there are no creeps in room
      const rc = spawn.recycleCreep(creep)
      if (rc === OK) {
        spawn.__recycled_this_tick__ = true
        return OK
      }
    }

    return ERR_NOT_FOUND
  }

  return ERR_BUSY
}

const moveAround = function (creep) {
  if (!creep.__legs__) {
    return ERR_INVALID_TARGET
  }

  return ERR_BUSY
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
  const structures = room.find(FIND_STRUCTURES)

  const structuresAtXY = _.filter(structures, s => s.pos.isEqualTo(x, y))

  // do not spawn into obstacle
  for (const structure of structuresAtXY) {
    if (_.some(OBSTACLE_OBJECT_TYPES, _.matches(structure.structureType))) {
      return ERR_INVALID_TARGET
    }
  }

  const terrain = room.getTerrain()
  const terrainAtXY = terrain.get(x, y)

  // do not spawn into wall
  if (terrainAtXY === TERRAIN_MASK_WALL) {
    for (const structure of structuresAtXY) {
      if (structure.structureType === STRUCTURE_ROAD) {
        return OK
      }
    }

    return ERR_BUSY
  }

  return OK
}

const grab = function (creep, what) {
  const targets = getGrabTargets(creep.room, what)

  let didWithdraw = false
  let didPickup = false

  for (const target of targets) {
    const from = target[target.type]

    if (!from.pos.isNearTo(creep)) continue

    if ((didWithdraw === false) && (target.type === LOOK_TOMBSTONES || target.type === LOOK_RUINS)) {
      const rc = creep.withdraw(from, what)
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

const getGrabTargets = function (room, what) {
  if (room.__grab_target_cache__ && room.__grab_target_cache__[what]) {
    return room.__grab_target_cache__[what]
  }

  const tombstones = room.find(FIND_TOMBSTONES)
  const ruins = room.find(FIND_RUINS)
  const resources = room.find(FIND_DROPPED_RESOURCES)
  const structures = room.find(FIND_STRUCTURES)

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

  for (const structure of structures) {
    // no withdraw from nuker possible
    if (structure.structureType === STRUCTURE_NUKER) continue

    if (!room.__no_spawn__) {
      if (structure.structureType !== STRUCTURE_CONTAINER &&
          structure.structureType !== STRUCTURE_TERMINAL) continue
    }

    if (structure.store && structure.store.getUsedCapacity(what) > 0) {
      targets.push(
        {
          type: LOOK_RUINS, // compatible :)
          [LOOK_RUINS]: structure
        }
      )
    }
  }

  if (room.__grab_target_cache__ === undefined) {
    room.__grab_target_cache__ = { }
  }

  return (room.__grab_target_cache__[what] = targets)
}

const getRestockTargets = function (room, what) {
  if (room.__restock_target_cache__ && room.__restock_target_cache__[what]) {
    return room.__restock_target_cache__[what]
  }

  const structures = room.find(FIND_STRUCTURES)

  const destinationStructures = _.filter(structures, s => s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_TERMINAL)

  const withDemand = _.filter(destinationStructures, s => (s.store && s.store.getFreeCapacity(what) > 0))

  if (room.__restock_target_cache__ === undefined) {
    room.__restock_target_cache__ = { }
  }

  return (room.__restock_target_cache__[what] = withDemand)
}

const creepXenergyXgate = function (creep, intentPower) {
  // how much (max) energy intent will spend
  const energyToPower = creep.__work__ * intentPower
  // upgrade controller is attempted every tick, and does not interfere with pipeline 1
  // keep enough energy to perform upgrade + intent this tick and upgrade + harvest next
  // when there is no spawn, to upgrade is performent, just optimize the intent number
  const energySpentOnUpgradeController = creep.room.__no_spawn__ ? 0 : creep.__work__ * UPGRADE_CONTROLLER_POWER * 2
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

  const canBeRepaired = _.filter(structures, s => (CONSTRUCTION_COST[s.structureType] && s.hits && s.hitsMax && s.hits < s.hitsMax && s.hits < hitsThreshold))

  // to speed up balance tests on sim, cap ramparts at 45k
  // on production limit to 3M; since there is no defence any way, just stop at this mark
  const rampartThreshold = Game.rooms.sim ? 45000 : 3000000

  const shouldBeRepaired = _.filter(canBeRepaired, s => (s.structureType !== STRUCTURE_RAMPART || s.hits < rampartThreshold))

  const mineOrNeutral = _.filter(shouldBeRepaired, s => (s.my || true))

  return (room.__repair_target_cache__ = mineOrNeutral)
}

const makeAlternativeName = function (name) {
  const alternativeName = name
    .replace(/a/g, 'ä')
    .replace(/а/g, 'ä')
    .replace(/o/g, 'ö')
    .replace(/о/g, 'ö')
    .replace(/u/g, 'ü')
    .replace(/и/g, 'й')
    .replace(/e/g, 'ё')
    .replace(/е/g, 'ё')

  if (alternativeName === name) {
    return `${name}_twin`
  } else {
    return alternativeName
  }
}

const maybeSpawnCreep = function (name1, name2, room, x, y) {
  // nope out
  if (room.__invasion_npc__) {
    return ERR_BUSY
  }

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
  let body = makeBody(room)
  if (body.length === 0) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  // penalty for walling
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) {
    // remove 1st element
    body = _.rest(body)
  }

  // by default, give 1st name
  const creepName = creep ? (creep.name === name1 ? name2 : name1) : name1

  // check if creep with enough life exists
  if (creep) {
    const ticksToSpawn = body.length * CREEP_SPAWN_TIME
    // experimentally tested to be this operator
    if (creep.ticksToLive >= ticksToSpawn) {
      return OK
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
    console.log(`No spawn in room [${room.name}] found for creep [${creepName}]`)
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

  // eslint-disable-next-line no-unused-vars
  const [energy, capacity] = roomEnergyAndEnergyCapacity(room)
  if (capacity <= 0) return []

  // n.b. WORK must be first, to properly penalize

  let body = [WORK, WORK, CARRY] // backup for 300 spawn trickle charge

  if (capacity >= 350) {
    body = [WORK, WORK, WORK, CARRY]
  }

  if (capacity >= 450) {
    body = [WORK, WORK, WORK, WORK, CARRY]
  }

  if (capacity >= 550) {
    body = [WORK, WORK, WORK, WORK, WORK, CARRY]
  }

  // TODO lock behind some gate
  //if (capacity >= 900) {
  //  body = [WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK, CARRY, MOVE]
  //}

  return (room.__make_body_cache__ = body)
}

const roomEnergyAndEnergyCapacity = function (room) {
  if (room.controller === undefined) return [0, 0]
  if (room.controller.level < 1) return [0, 0]

  const structures = room.find(FIND_STRUCTURES)

  let spawns = _.filter(structures, _.matchesProperty('structureType', STRUCTURE_SPAWN))
  // do expensive check only if sus
  if (spawns.length > CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][room.controller.level]) {
    spawns = _.filter(spawns, s => s.isActive())
  }

  // no spawn at all
  if (spawns.length === 0) return [0, 0]

  let extensions = _.filter(structures, _.matchesProperty('structureType', STRUCTURE_EXTENSION))
  // do expensive check only if sus
  if (extensions.length > CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level]) {
    extensions = _.filter(extensions, s => s.isActive())
  }

  // see how much potential energy can be restocked
  // in case there is no creep nearby to restock, do "one last bang"
  // n.b. expect that all creeps do restock
  // n.b. does not accout for power creeps

  const creepsInRoom = _.filter(Game.creeps, s => !s.spawning && s.room.name === room.name)
  let energy = 0
  let capacity = 0

  for (const spawn of spawns) {
    const stored = spawn.store.getUsedCapacity(RESOURCE_ENERGY)
    energy += stored

    if (_.some(creepsInRoom, s => s.pos.isNearTo(spawn))) {
      capacity += SPAWN_ENERGY_CAPACITY
    } else {
      capacity += stored
    }
  }

  for (const extension of extensions) {
    const stored = extension.store.getUsedCapacity(RESOURCE_ENERGY)
    energy += stored

    if (_.some(creepsInRoom, s => s.pos.isNearTo(extension))) {
      capacity += EXTENSION_ENERGY_CAPACITY[room.controller.level]
    } else {
      capacity += stored
    }
  }

  // because trickle charge will fill at least to this level
  return [energy, Math.max(capacity, SPAWN_ENERGY_CAPACITY)]
}

const processRoomEventLog = function (room) {
  // for now handle only own controlled rooms
  if (room.controller === undefined) return
  if (!room.controller.my) return

  const eventLog = room.getEventLog()

  for (const eventRecord of eventLog) {
    switch (eventRecord.event) {
      case EVENT_ATTACK:
        handleEventAttack(room, eventRecord)
        break
      default:
        break
    }
  }
}

const handleEventAttack = function (room, eventRecord) {
  // fight back is automatic
  if (eventRecord.data.attackType === EVENT_ATTACK_TYPE_HIT_BACK) return
  // nuke is detected elsewhere
  if (eventRecord.data.attackType === EVENT_ATTACK_TYPE_NUKE) return

  const attacker = getObjectByIdDeadOrAlive(room, eventRecord.objectId)
  if (attacker === null || attacker.owner === undefined || attacker.my) return

  const target = getObjectByIdDeadOrAlive(room, eventRecord.data.targetId)
  if (target === null) return

  let hostileAction = false

  if (target.owner) {
    hostileAction = target.my
  } else {
    // n.b. does not handle reserved rooms
    hostileAction = room.controller ? room.controller.my : false
  }

  if (hostileAction === false) return

  const isNpcAttack = _.some(NPC_USERNAMES, _.matches(attacker.owner.username))

  if (isNpcAttack) {
    // actually Invader will not attack spawn, but still
    if (target.structureType && target.structureType === STRUCTURE_SPAWN) {
      activateSafeMode(room)
    }
  } else {
    if (target.hits <= 0) {
      activateSafeMode(room)
    }
  }
}

const getObjectByIdDeadOrAlive = function (room, id) {
  const ownStructure = Game.structures[id]
  if (ownStructure) return ownStructure

  const byId = Game.getObjectById(id)
  if (byId !== null) {
    return byId
  }

  const tombstones = room.find(FIND_TOMBSTONES)
  const byTombstone = _.find(tombstones, _.matchesProperty('creep.id', id))
  if (byTombstone !== undefined) {
    return byTombstone.creep
  }

  const ruins = room.find(FIND_RUINS)
  const byRuin = _.find(ruins, _.matchesProperty('structure.id', id))
  if (byRuin !== undefined) {
    return byRuin.structure
  }

  // as original API
  return null
}

const NPC_USERNAMES = [
  'Invader',
  'Power Bank',
  'Public',
  SYSTEM_USERNAME,
  'Source Keeper'
]

const activateSafeMode = function (room) {
  if (room.__safe_mode_attempted__) return ERR_BUSY

  const target = room.controller
  if (target === undefined) return ERR_INVALID_TARGET
  if (!target.my) return ERR_NOT_OWNER
  if (!target.canActivateSafeMode()) return ERR_NOT_ENOUGH_RESOURCES

  room.__safe_mode_attempted__ = true

  const rc = target.activateSafeMode()

  // signal successful intent to following code
  room.__safe_mode_active__ = rc === OK

  const message = `Attempting to activate safe mode at room [${room.name} with rc [${rc}]`
  console.log(message)
  Game.notify(message)

  return rc
}

const handleRoomState = function (room) {
  if (room.controller === undefined) {
    room.__level__ = 0
  }

  if (!room.controller.my) {
    room.__level__ = 0
  }

  if (room.__level__ === undefined) {
    room.__level__ = room.controller.level
  }

  if (room.__level__ === 8 && room.controller.isPowerEnabled) {
    room.__level__ = 9
  }

  // TODO release level 8 after invent how to manage
  if (room.__level__ && room.__level__ > 7) {
    room.__level__ = 7
  }

  if (room.__level__ > 0) {
    const maxLevel = room.memory.maxLevel || 0
    if (maxLevel < room.__level__) {
      room.memory.maxLevel = room.__level__
    }
  } else {
    room.memory.maxLevel = undefined
  }

  // detect and handle no spawn state
  const structures = room.find(FIND_STRUCTURES)
  room.__no_spawn__ = !_.some(structures, _.matchesProperty('structureType', STRUCTURE_SPAWN))

  const hostiles = room.find(FIND_HOSTILE_CREEPS)
  if (hostiles.length > 0) {
    room.__invasion__ = true

    for (const hosile of hostiles) {
      const username = hosile.owner ? hosile.owner.username : undefined
      const isNpc = _.some(NPC_USERNAMES, _.matches(username))
      if (isNpc) {
        room.__invasion_npc__ = true
      } else {
        room.__invasion_pc__ = true
      }

      if (room.__invasion_npc__ && room.__invasion_pc__) break
    }
  }

  // oops
  if (room.__no_spawn__ && room.__invasion__) {
    activateSafeMode(room)
  }

  // detect ongoing safe mode
  if (room.controller.safeMode) {
    room.__safe_mode_active__ = true
  }

  // cancel out invasion
  if (room.__safe_mode_active__) {
    room.__invasion__ = false
    room.__invasion_pc__ = false
    room.__invasion_npc__ = false
  }

  if (room.__no_spawn__) room.__emergency__ = true
  else if (room.__invasion__) room.__emergency__ = true
  else room.__emergency__ = false
}

StructureController.prototype.canActivateSafeMode = function () {
  if (this.safeMode) return false
  if (this.safeModeCooldown) return false
  if (this.upgradeBlocked) return false

  return this.safeModeAvailable > 0
}

const performAutobuild = function () {
  const force = Memory.forceAutobuild === true
  const period = Game.rooms.sim ? 10 : CREEP_LIFE_TIME

  Memory.forceAutobuild = undefined

  if (force || (Game.time % period === 0)) {
    for (const roomName in Game.rooms) {
      Game.rooms[roomName].buildFromPlan()
    }
  } else {
    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName]
      if (room.__no_spawn__) {
        room.buildFromPlan()
      }
    }
  }
}

const indexFromXY = function (x, y) {
  return (y + 1) * 100 + x
}

const indexFromPosition = function (position) {
  return indexFromXY(position.x, position.y)
}

const positionFromIndex = function (index) {
  const y = Math.floor(index / 100) - 1
  const x = index % 100
  return { x, y }
}

const findNearToBoth = function (position1, position2) {
  const nearTo = function (position) {
    const result = new Array(8)
    for (let dx = -1; dx <= 1; ++dx) {
      for (let dy = -1; dy <= 1; ++dy) {
        if (dx === 0 && dy === 0) continue

        const x = position.x + dx
        if (x < 0) continue
        if (x > 49) continue

        const y = position.y + dy
        if (y < 0) continue
        if (y > 49) continue

        result.push(indexFromXY(x, y))
      }
    }
    return result
  }

  const nearTo1 = nearTo(position1)
  const nearTo2 = nearTo(position2)
  const nearToBoth = _.intersection(nearTo1, nearTo2)

  return _.map(nearToBoth, positionFromIndex)
}

Room.prototype.getPlan = function () {
  const structures = this
    .find(FIND_STRUCTURES)
    .sort(
      (s1, s2) => {
        const index1 = indexFromPosition(s1.pos)
        const index2 = indexFromPosition(s2.pos)
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
    // TODO remove because this is not a valid
    findNearToBoth({ x: 4, y: 4 }, { x: 12, y: 13 })
    return undefined
  }

  return plan
}

Room.prototype.buildFromPlan = function () {
  const plans = ROOM_PLANS[this.name]
  if (plans === undefined) return

  const plan = plans[this.memory.maxLevel || this.__level__]
  if (plan === undefined) return

  const structures = this.find(FIND_STRUCTURES)
  const constructionSites = this.find(FIND_CONSTRUCTION_SITES)

  let constructionSitesCreated = false

  for (let i = 0; i < plan.length; ++i) {
    const code = plan.charCodeAt(i)
    const [position, structureType] = Structure.prototype.decode(code)
    if (structureType === undefined) continue

    if (this.__no_spawn__ && structureType !== STRUCTURE_SPAWN) continue

    const structuresAtXY = _.filter(structures, s => s.pos.isEqualTo(position.x, position.y))
    const constructionSitesAtXY = _.filter(constructionSites, s => s.pos.isEqualTo(position.x, position.y))

    let builtOrPlanned = false

    for (const structure of structuresAtXY) {
      if (structure.structureType === structureType) {
        structure.__according_to_plan__ = true
        builtOrPlanned = true
        break
      }
    }

    for (const constructionSite of constructionSitesAtXY) {
      if (constructionSite.structureType === structureType) {
        constructionSite.__according_to_plan__ = true
        builtOrPlanned = true
        break
      }
    }

    if (builtOrPlanned) continue

    let positionBusy = false

    if (this.__no_spawn__) {
      for (const structure of structuresAtXY) {
        if (_.some(OBSTACLE_OBJECT_TYPES, _.matches(structure.structureType))) {
          structure.__destroy__ = true
          positionBusy = true
        }
      }

      for (const constructionSite of constructionSitesAtXY) {
        constructionSite.__destroy__ = true
        positionBusy = true
      }
    }

    if (positionBusy) continue

    const rc = this.createConstructionSite(position.x, position.y, structureType)
    constructionSitesCreated = constructionSitesCreated || (rc === OK)
  }

  const maxLevel = this.memory.maxLevel || 0
  const hasConstructionSites = constructionSitesCreated || (constructionSites.length > 0)
  const hasPlannedSpawns = _.some(structures, s => s.structureType === STRUCTURE_SPAWN && s.__according_to_plan__ && s.__destroy__ !== true)

  // replace outside of emergencies
  // replace only with higher level plans
  // replace one by one
  if (!this.__emergency__ && (this.__level__ >= maxLevel) && !hasConstructionSites) {
    for (const structure of structures) {
      if (structure.__according_to_plan__) continue
      if (structure.__destroy__) continue

      // no doubts over non-spawn
      if (structure.structureType !== STRUCTURE_SPAWN) {
        structure.__destroy__ = true
        break // one at a time
      }

      // spawn that is not according to plan

      // only if there are spawns according to plan
      if (hasPlannedSpawns) {
        structure.__destroy__ = true
        break // one at a time
      }
    }
  }

  // replace outside of emergencies
  // replace only with higher level plans
  if (!this.__emergency__ && (this.__level__ >= maxLevel)) {
    for (const constructionSite of constructionSites) {
      if (constructionSite.__according_to_plan__) continue
      if (constructionSite.__destroy__) continue

      // no doubts over non-spawn
      if (constructionSite.structureType !== STRUCTURE_SPAWN) {
        constructionSite.__destroy__ = true
      }

      // spawn construction site that is not according to plan

      // only if there are spawns according to plan
      if (hasPlannedSpawns) {
        constructionSite.__destroy__ = true
      }
    }
  }

  let destroyed = false

  for (const structure of structures) {
    if (structure.__destroy__) {
      const rc = structure.destroy()
      destroyed = destroyed || (rc === OK)
    }
  }

  for (const constructionSite of constructionSites) {
    if (constructionSite.__destroy__) {
      const rc = constructionSite.remove()
      destroyed = destroyed || (rc === OK)
    }
  }

  if (destroyed) {
    Memory.forceAutobuild = true
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

  return ERR_BUSY
}

const clearMemory = function () {
  Memory.creeps = undefined
  Memory.flags = undefined
  Memory.spawns = undefined

  for (const name in Memory.rooms) {
    if (Game.rooms[name]) {
      Memory.rooms[name] = _.pick(
        Memory.rooms[name],
        [
          'maxLevel'
        ]
      )
    } else {
      Memory.rooms[name] = undefined
    }
  }
}
