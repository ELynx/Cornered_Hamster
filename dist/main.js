console.log('Code loaded')

const IS_SIM = Game.rooms.sim !== undefined

const CONTROLLER_SIGN_TEXT = 'https://github.com/ELynx/Cornered_Hamster'
let forcedControllerSign = true // once in code load force the sign, it is visible on new world map

// because doing/importing intent system just for terminal is too much
// actively fill terminal with energy up to this level
const TERMINAL_ENERGY_RESERVE_LOW = Math.floor(TERMINAL_CAPACITY * 0.05)
// actively draw energy from terminal from this level
const TERMINAL_ENERGY_RESERVE_HIGH = TERMINAL_ENERGY_RESERVE_LOW + 150

// TODO position in in string encodes creep type
const ROOM_PLANS = {
  E56N59: {
    0: 'ࢃःऄ룃', // spawn
    1: 'ࢃःऄ룃', // spawn
    2: 'ࢃःऄ룃⢂⣂⤂⥃⥄', // spawn + 5 extensions
    3: 'ࢃःऄ룃⡂⢂⣂⤂⥃⥄', // spawn + 6 extensions
    4: 'ࢃःऄ룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // spawn + 6 extensions + 3 containers + spawn rampart
    5: 'ࢃःऄ룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // -//-
    6: 'ࢃःऄ룃⡂⢂⣂⤂⥃⥄ᢃᤃᤄ飃', // -//-
    7: 'ࢃःऄ룃뤂⡂⢂⥃⥄ᢃᤃᤄ飃餂飂', // mutate extension into spawn + spawn rampart, mutate extension into terminal + terminal rampart
    8: 'ࢃःऄ룃뤂뢂⡂⥃⥄ᢃᤃᤄ飃餂飂颂' // mutate extension into spawn + spawn rampart
  }
}

if (IS_SIM) {
  ROOM_PLANS.sim = ROOM_PLANS.E56N59
}

const makeShortcuts = function () {
  Game.valueRooms = _.shuffle(_.values(Game.rooms))
  Game.valueFlags = _.shuffle(_.values(Game.flags))
  Game.valueCreeps = _.shuffle(_.values(Game.creeps))
  Game.keyOrders = _.keys(Game.market.orders)
  Game.valueOrders = _.values(Game.market.orders)

  for (const room of Game.valueRooms) {
    if (room.controller && room.controller.my) {
      room.valueSpawns = []
      const structures = room.find(FIND_STRUCTURES)

      for (const structure of structures) {
        switch (structure.structureType) {
          case STRUCTURE_SPAWN:
            room.valueSpawns.push(structure)
            break
          default:
            break
        }
      }

      room.valueSpawns = _.shuffle(room.valueSpawns)
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

StructureController.prototype.canActivateSafeMode = function () {
  if (this.safeMode) return false
  if (this.safeModeCooldown) return false
  if (this.upgradeBlocked) return false

  return this.safeModeAvailable > 0
}

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

const handleRoomEventLog = function (room) {
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

const handleEventLogs = function () {
  for (const room of Game.valueRooms) {
    handleRoomEventLog(room)
  }
}

const handleRoomState = function (room) {
  if (!room.controller || !room.controller.my) {
    room.__level__ = 0
    room.memory.maxLevel = undefined
    return
  }

  room.__level__ = room.controller.level

  const maxLevel = room.memory.maxLevel || 0
  if (maxLevel < room.__level__) {
    room.memory.maxLevel = room.__level__
  }

  // detect and handle no spawn state
  room.__no_spawn__ = room.valueSpawns.length === 0

  const hostileCreeps = _.filter(room.find(FIND_CREEPS), s => !s.my)
  const hostilePowerCreeps = _.filter(room.find(FIND_POWER_CREEPS), s => !s.my)

  const hostiles = hostileCreeps.concat(hostilePowerCreeps)

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
    room.__invasion__ = undefined
    room.__invasion_pc__ = undefined
    room.__invasion_npc__ = undefined
  }

  if (room.__no_spawn__) room.__emergency__ = true
  if (room.__invasion__) room.__emergency__ = true

  // TODO make safe modes
  // for that, spawn capacity only creep + boost, because need 1000 G
  // keep this in mind when planning how much G to buy
}

const handleStates = function () {
  for (const room of Game.valueRooms) {
    handleRoomState(room)
  }
}

const spawnCreepXgate = function (room, x, y) {
  if (!room.controller || !room.controller.my) {
    return ERR_NOT_OWNER
  }

  if (room.valueSpawns.length === 0) {
    return ERR_NOT_FOUND
  }

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

  // TODO consider power creeps
  const creepsInRoom = _.filter(room.find(FIND_CREEPS), s => s.my)
  let energy = room.__spent__ || 0
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

const _getBody = function (work, carry = 1) {
  const works = new Array(work)
  works.fill(WORK)

  const carries = new Array(carry)
  carries.fill(CARRY)

  return works.concat(carries)
}

const _getCost = function (body) {
  let cost = 0
  for (const part of body) {
    cost += BODYPART_COST[part] || 0
  }
  return cost
}

const Work2Carry1Body = _getBody(2) // backup for 300 spawn trickle charge
const Work2Carry1Cost = _getCost(Work2Carry1Body)

const Work3Carry1Body = _getBody(3)
const Work3Carry1Cost = _getCost(Work3Carry1Body)

const Work4Carry1Body = _getBody(4)
const Work4Carry1Cost = _getCost(Work4Carry1Body)

const Work5Carry1Body = _getBody(5)
const Work5Carry1Cost = _getCost(Work5Carry1Body)

const makeBody = function (room) {
  // eslint-disable-next-line no-unused-vars
  const [energy, capacity] = roomEnergyAndEnergyCapacity(room)
  if (capacity <= 0) return [[], 0]

  let body = Work2Carry1Body
  let cost = Work2Carry1Cost

  if (capacity >= Work3Carry1Cost) {
    body = Work3Carry1Body
    cost = Work3Carry1Cost
  }

  if (capacity >= Work4Carry1Cost) {
    body = Work4Carry1Body
    cost = Work4Carry1Cost
  }

  if (capacity >= Work5Carry1Cost) {
    body = Work5Carry1Body
    cost = Work5Carry1Cost
  }

  return [body, cost]
}

const spawnCreepImpl = function (name1, name2, room, x, y) {
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
  const [body, cost] = makeBody(room)
  if (body.length === 0) {
    return ERR_NOT_ENOUGH_RESOURCES
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

  for (const spawn of room.valueSpawns) {
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
      room.__spent__ = (room.__spent__ || 0) - cost
      return OK
    }
  }

  return ERR_NOT_FOUND
}

const spawnCreep = function (creepName, room, x, y) {
  const gateRc = spawnCreepXgate(room, x, y)
  if (gateRc !== OK) {
    return gateRc
  }

  const name1 = creepName
  const name2 = makeAlternativeName(creepName)

  return spawnCreepImpl(name1, name2, room, x, y)
}

const spawnCreepByFlag = function (flag) {
  if (flag.room === undefined) {
    return ERR_NOT_IN_RANGE
  }
  return spawnCreep(flag.name, flag.room, flag.pos.x, flag.pos.y)
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

      if (what === RESOURCE_ENERGY && structure.structureType === STRUCTURE_TERMINAL) {
        const now = structure.store.getUsedCapacity(what)
        if (now <= TERMINAL_ENERGY_RESERVE_HIGH) continue
      }
    }

    if (structure.store && structure.store.getUsedCapacity(what) > 0) {
      targets.push(
        {
          type: LOOK_STRUCTURES,
          [LOOK_STRUCTURES]: structure
        }
      )
    }
  }

  if (room.__grab_target_cache__ === undefined) {
    room.__grab_target_cache__ = { }
  }

  return (room.__grab_target_cache__[what] = targets)
}

const grab = function (creep, what) {
  let didWithdraw = creep.__pipeline_withdraw__ || false
  let didPickup = creep.__pipeline_pickup__ || false

  if (didWithdraw && didPickup) {
    return ERR_BUSY
  }

  const targets = getGrabTargets(creep.room, what)

  for (const target of targets) {
    const from = target[target.type]

    if (!from.pos.isNearTo(creep)) continue

    if ((didWithdraw === false) && (target.type === LOOK_TOMBSTONES || target.type === LOOK_RUINS || target.type === LOOK_STRUCTURES)) {
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

  if (didWithdraw) {
    creep.__pipeline_withdraw__ = true
  }

  if (didPickup) {
    creep.__pipeline_pickup__ = true
  }

  if (didWithdraw || didPickup) return OK

  return ERR_NOT_FOUND
}

const grabEnergy = function (creep) {
  const rc = grab(creep, RESOURCE_ENERGY)
  if (rc === OK) {
    creep.__energy_income__ = true
  }

  return rc
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

const getRestockTargets = function (room, what) {
  if (room.__restock_target_cache__ && room.__restock_target_cache__[what]) {
    return room.__restock_target_cache__[what]
  }

  const structures = room.find(FIND_STRUCTURES)

  const destinationStructures = _.filter(
    structures,
    s => {
      if (s.structureType === STRUCTURE_CONTAINER) {
        return false
      }

      if (what === RESOURCE_ENERGY && s.structureType === STRUCTURE_TERMINAL) {
        const now = s.store.getUsedCapacity(what)
        if (now >= TERMINAL_ENERGY_RESERVE_LOW) {
          return false
        }
      }

      return true
    }
  )

  const withDemand = _.filter(destinationStructures, s => (s.store && s.store.getFreeCapacity(what) > 0))

  if (room.__restock_target_cache__ === undefined) {
    room.__restock_target_cache__ = { }
  }

  return (room.__restock_target_cache__[what] = withDemand)
}

const restock = function (creep, what) {
  if (creep.__pipeline_transfer__) {
    return ERR_BUSY
  }

  const targets = getRestockTargets(creep.room, what)

  const inRange = _.filter(targets, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.transfer(_.sample(inRange), what)
  if (rc === OK) {
    creep.__pipeline_transfer__ = true
  }

  return rc
}

const restockEnergy = function (creep) {
  if (creep.room.__no_spawn__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  return restock(creep, RESOURCE_ENERGY)
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

  const mineOrNeutral = _.filter(structures, s => (s.my || true))

  const canBeRepaired = _.filter(mineOrNeutral, s => (CONSTRUCTION_COST[s.structureType] && s.hits && s.hitsMax && s.hits < s.hitsMax && s.hits < hitsThreshold))

  // based on 5 big boosted (+100%) invaders
  // melee  =  3 ranged x 10 x 2 + 4 work x 50 x 2 + 2 attack x 30 x 2 =  60 ranged + 520 melee = 580 focused
  // ranged = 18 ranged x 10 x 2 + 1 work x 50 x 2 + 0 attack x 30 x 2 = 360 ranged + 100 melee = 460 focused
  // for outer line, 3 melee + 2 ranged attacking single spot = 2660 focused
  // for inner line, 5 ranged attacking single spot = 1800 ranged
  // 300 decay per 100 ticks add another 4500 hits lost
  // given lifetime of 1500, total damage under worst luck
  // outer line 3990000 + 4500 = 3994500
  // inner line 2700000 + 4500 = 2704500
  const rampartThresholdOuter = IS_SIM ? 40000 : 3994500
  const rampartThresholdInner = IS_SIM ? 27100 : 2704500

  const shouldBeRepaired = _.filter(
    canBeRepaired, s => {
      if (s.structureType !== STRUCTURE_RAMPART) return true

      // this is not scientifically accurate, but works for now
      const outerLayer = s.pos.y <= 2 || s.pos.y >= 48 || s.pos.x <= 2 || s.pos.x >= 48
      return s.hits < (outerLayer ? rampartThresholdOuter : rampartThresholdInner)
    }
  )

  return (room.__repair_target_cache__ = shouldBeRepaired)
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
    creep.__gated__ = true
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
    creep.__gated__ = true
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

  const targets = creep.room.find(FIND_SOURCES)

  const withEnergy = _.filter(targets, s => s.energy > 0)

  const inRange = _.filter(withEnergy, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.harvest(_.sample(inRange))
  if (rc === OK) {
    creep.__pipeline_1__ = 1
    creep.__energy_income__ = true
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
    creep.__energy_income__ = true
  }

  return rc
}

const SHARE_FRACTION = 2

const shareEnergy = function (creep) {
  if (creep.__pipeline_transfer__) {
    return ERR_BUSY
  }

  if (!creep.__energy_income__ || creep.__gated__) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY)
  if (hasEnergy < SHARE_FRACTION) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  // power creep will not be found
  const targets = creep.room.find(FIND_CREEPS)

  const mine = _.filter(targets, s => s.my)

  // hope that shuffle will get them in right order
  const empty = _.filter(mine, s => s.__gated__ || s.store.getUsedCapacity(RESOURCE_ENERGY) === 0)

  const inRange = _.filter(empty, s => s.pos.isNearTo(creep))
  if (inRange.length === 0) {
    return ERR_NOT_FOUND
  }

  const rc = creep.transfer(_.sample(inRange), RESOURCE_ENERGY, Math.floor(hasEnergy / SHARE_FRACTION))
  if (rc === OK) {
    creep.__pipeline_transfer__ = true
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

  if (creep.body.length !== creep.__work__) {
    return ERR_INVALID_TARGET
  }

  if (creep.room.__invasion_npc__ && (creep.room.__can_fight__ !== true)) {
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
      // because Invader is inactive when there is no creeps in room
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

const work = function (creep) {
  signController(creep)
  grabEnergy(creep)
  upgradeController(creep)
  restockEnergy(creep)
  repair(creep)
  build(creep)
  harvest(creep)
  dismantle(creep)
  shareEnergy(creep)
  cancelConstructionSites(creep)
  handleInvasion(creep)

  return OK
}

const controlCreeps = function () {
  for (const flag of Game.valueFlags) {
    spawnCreepByFlag(flag)
  }

  for (const creep of Game.valueCreeps) {
    if (creep.spawning) continue

    creep.__work__ = creep.getActiveBodyparts(WORK)

    if (creep.__work__ > 0) {
      work(creep)
    }
  }
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

Structure.prototype.decode = function (code) {
  const index = (code & 0b1111000000000000) >> 12
  const xxxxx = (code & 0b0000111111000000) >> 6
  const yyyyyy = code & 0b0000000000111111

  const structureType = IndexToStructureType[index]

  return [{ x: xxxxx, y: yyyyyy }, structureType]
}

Room.prototype._buildNormal = function (position, structureType, removeObstacles = false) {
  if (structureType === STRUCTURE_WALL) {
    return false
  }

  const structuresAtXY = _.filter(this._structures, s => s.pos.isEqualTo(position.x, position.y))
  const constructionSitesAtXY = _.filter(this._constructionSites, s => s.pos.isEqualTo(position.x, position.y))

  for (const structure of structuresAtXY) {
    if (structure.structureType === structureType) {
      structure.__according_to_plan__ = true
      return false
    }
  }

  for (const constructionSite of constructionSitesAtXY) {
    if (constructionSite.structureType === structureType) {
      constructionSite.__according_to_plan__ = true
      return false
    }
  }

  let positionBusy = false

  if (removeObstacles) {
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

  if (positionBusy) {
    return false
  }

  const rc = this.createConstructionSite(position.x, position.y, structureType)
  return rc === OK
}

Room.prototype._buildNoSpawn = function (position, structureType) {
  if (structureType !== STRUCTURE_SPAWN) {
    return false
  }

  return this._buildNormal(position, structureType, true)
}

Room.prototype._buildFlag = function (position, structureType, index) {
  if (structureType !== STRUCTURE_WALL) {
    return false
  }

  const flagName = `worker${this.name}${_.padLeft(position.x, 2, '0')}${_.padLeft(position.y, 2, '0')}${_.padLeft(index, 2, '0')}`
  const flag = Game.flags[flagName]

  if (flag) {
    if (flag.pos.roomName === this.name &&
      flag.pos.x === position.x &&
      flag.pos.y === position.y &&
      flag.color === COLOR_YELLOW &&
      flag.secondaryColor === COLOR_YELLOW) {
      flag.__according_to_plan__ = true
    }

    return false
  }

  // no need to tag, will appear only on next tick
  const rc = this.createFlag(position.x, position.y, flagName, COLOR_YELLOW, COLOR_YELLOW)
  return rc === OK
}

Room.prototype._handleNotPlanned = function () {
  // replace only outside of emergencies
  if (this.__emergency__) {
    return
  }

  // replace only with higher level plans
  const maxLevel = this.memory.maxLevel || 0
  if (this.__level__ < maxLevel) {
    return
  }

  const hasConstructionSites = this._constructionSitesCreated || (this._constructionSites.length > 0)
  const hasPlannedSpawns = _.some(this._structures, s => s.structureType === STRUCTURE_SPAWN && s.__according_to_plan__ && s.__destroy__ !== true)

  // replace one by one
  if (!hasConstructionSites) {
    for (const structure of this._structures) {
      if (structure.structureType === STRUCTURE_CONTROLLER) continue
      if (structure.structureType === STRUCTURE_EXTRACTOR) continue

      if (structure.__according_to_plan__) continue
      if (structure.__destroy__) continue

      // no doubts over non-spawn
      if (structure.structureType !== STRUCTURE_SPAWN) {
        structure.__destroy__ = true
        break // add one at a time
      }

      // spawn that is not according to plan

      // only if there are spawns according to plan
      if (hasPlannedSpawns) {
        structure.__destroy__ = true
        break // add one at a time
      }
    }
  }

  for (const constructionSite of this._constructionSites) {
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

  for (const flag of Game.valueFlags) {
    if (flag.__according_to_plan__) continue
    if (flag.__destroy__) continue

    flag.__destroy__ = true
  }
}

Room.prototype._handleToBeDestroyed = function () {
  let destroyed = false

  for (const structure of this._structures) {
    if (structure.__destroy__) {
      const rc = structure.destroy()
      destroyed = destroyed || (rc === OK)
    }
  }

  for (const constructionSite of this._constructionSites) {
    if (constructionSite.__destroy__) {
      const rc = constructionSite.remove()
      destroyed = destroyed || (rc === OK)
    }
  }

  for (const flag of Game.valueFlags) {
    if (flag.__destroy__) {
      const rc = flag.remove()
      destroyed = destroyed || (rc === OK)
    }
  }

  if (destroyed) {
    Memory.forceAutobuild = true
  }
}

Room.prototype.buildFromPlan = function () {
  const plans = ROOM_PLANS[this.name]
  if (plans === undefined) return

  const plan = plans[this.memory.maxLevel || this.__level__]
  if (plan === undefined) return

  this._structures = _.filter(this.find(FIND_STRUCTURES), s => (s.my || true))
  this._constructionSites = this.find(FIND_CONSTRUCTION_SITES)

  let constructionSitesCreated = false

  for (let i = 0; i < plan.length; ++i) {
    const code = plan.charCodeAt(i)
    const [position, structureType] = Structure.prototype.decode(code)
    if (structureType === undefined) continue

    let constructionSiteCreated = false

    if (this.__no_spawn__) {
      constructionSiteCreated = this._buildNoSpawn(position, structureType)
    } else {
      constructionSiteCreated = this._buildNormal(position, structureType)
    }

    constructionSitesCreated = constructionSitesCreated || constructionSiteCreated

    this._buildFlag(position, structureType, i)
  }

  this._constructionSitesCreated = constructionSitesCreated

  this._handleNotPlanned()
  this._handleToBeDestroyed()

  this._structures = undefined
  this._constructionSites = undefined
  this._constructionSitesCreated = undefined
}

const performAutobuild = function () {
  const force = Memory.forceAutobuild === true
  const timer = Game.time % (IS_SIM ? 15 : CREEP_LIFE_TIME) === 0

  Memory.forceAutobuild = undefined

  for (const room of Game.valueRooms) {
    if (room.__no_spawn__ || force || timer) {
      room.buildFromPlan()
    }
  }
}

const __NO_ORDERS__ = { [ORDER_SELL]: [], [ORDER_BUY]: [], empty: true }

const getOrdersForType = function (resourceType, options) {
  if (options && options.limit && options.limit < 1) {
    return __NO_ORDERS__
  }

  const allOrders = Game.market.getAllOrders({ resourceType })

  const notMyOrders = _.filter(allOrders, s => !_.some(Game.keyOrders, _.matches(s.id)))
  if (notMyOrders.length === 0) {
    return __NO_ORDERS__
  }

  const grouped = _.groupBy(notMyOrders, 'type')
  let sellOrders = grouped[ORDER_SELL] || []
  let buyOrders = grouped[ORDER_BUY] || []

  if (sellOrders.length === 0 || buyOrders.length === 0) {
    return __NO_ORDERS__
  }

  sellOrders = _.sortByOrder(sellOrders, ['price'], ['asc'])
  buyOrders = _.sortByOrder(buyOrders, ['price'], ['desc'])

  if (options && options.limit) {
    if (options.limit > 1) {
      sellOrders = _.take(sellOrders, options.limit)
      buyOrders = _.take(buyOrders, options.limit)
    } else {
      // shortcut to spare extra array index
      sellOrders = _.first(sellOrders)
      buyOrders = _.first(buyOrders)
    }
  }

  return { [ORDER_SELL]: sellOrders, [ORDER_BUY]: buyOrders, empty: false }
}

// does not care for order direction
const storePriceToMemory = function (what, price) {
  if (Memory.prices === undefined) {
    Memory.prices = { }
  }

  Memory.prices[what] = price
}

const ENERGY_DISCOUNT = 0.15
const ENERGY_PER_EMPTY_SOURCE_PER_TRANSACTION = 450
const ENERGY_EXTRA_COST_TOLERANCE = 0.334

const buyEnergy = function (room) {
  const hasEnergy = room.terminal.store.getUsedCapacity(RESOURCE_ENERGY)

  // precaution, do not overbuy energy
  if (hasEnergy >= 2 * TERMINAL_ENERGY_RESERVE_LOW) {
    return ERR_BUSY
  }

  const sources = room.find(FIND_SOURCES)
  const withEnergy = _.filter(sources, s => s.energy > 0)
  if (withEnergy.length > 0) {
    return ERR_BUSY
  }

  const orders = getOrdersForType(RESOURCE_ENERGY)
  if (orders.empty) {
    return ERR_NOT_FOUND
  }

  const sellOrders = orders[ORDER_SELL]

  const lowestSellPrice = sellOrders[0].price
  const highestBuyPrice = orders[ORDER_BUY][0].price

  const howHighToBuy = highestBuyPrice * (1.0 + ENERGY_DISCOUNT)

  // no good deals at all, leave
  if (lowestSellPrice > howHighToBuy) {
    return ERR_NOT_IN_RANGE
  }

  if (lowestSellPrice > Game.market.credits) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const wantToBuy = Math.max(sources.length, 1) * ENERGY_PER_EMPTY_SOURCE_PER_TRANSACTION

  const viableSellOrders = []
  for (const sellOrder of sellOrders) {
    const cost1000 = Game.market.calcTransactionCost(1000, sellOrder.roomName, room.name)
    const canDeal = Math.floor(1000 * hasEnergy / cost1000)
    if (canDeal < 1) {
      continue
    }

    const canAfford = Math.floor(Game.market.credits / sellOrder.price)
    if (canAfford < 1) {
      continue
    }

    sellOrder.actualAmount = Math.min(canDeal, canAfford, sellOrder.amount, wantToBuy)
    sellOrder.energyCost = Game.market.calcTransactionCost(sellOrder.actualAmount, sellOrder.roomName, room.name)
    if (sellOrder.actualAmount <= sellOrder.energyCost) {
      continue
    }

    sellOrder.actualPrice = sellOrder.price * sellOrder.actualAmount / (sellOrder.actualAmount - sellOrder.energyCost)
    if (sellOrder.actualPrice / sellOrder.price > 1.0 + ENERGY_EXTRA_COST_TOLERANCE) {
      continue
    }

    viableSellOrders.push(sellOrder)
  }

  if (viableSellOrders.length === 0) {
    return ERR_NOT_IN_RANGE
  }

  const sortedViableSellOrders = _.sortByOrder(viableSellOrders, ['actualPrice', 'actualAmount', 'energyCost'], ['asc', 'desc', 'asc'])
  const theOrder = _.first(sortedViableSellOrders)

  const rc = Game.market.deal(theOrder.id, theOrder.actualAmount, room.name)
  console.log(`Deal with rc [${rc}] for [${theOrder.actualAmount}] energy. Order [${theOrder.id}] from [${theOrder.roomName}]. List price [${theOrder.price}], adjusted price [${theOrder.actualPrice}], cost [${theOrder.energyCost} energy]`)
  if (rc === OK) {
    storePriceToMemory(RESOURCE_ENERGY, theOrder.price)
  }

  return rc
}

const performRoomTrading = function (room) {
  if (buyEnergy(room) === OK) return OK

  return ERR_NOT_FOUND
}

const PIXELS_TO_KEEP = 500
const PIXELS_DISCOUNT = 0.15
const performPixelTrading = function () {
  // memo
  // ORDER_SELL: pixels increase, credits decrease; lowest price best
  // ORDER_BUY: pixels decrease, credits increase; highest price best

  const hasPixels = Game.resources[PIXEL] || 0
  if (hasPixels <= 0) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  const orders = getOrdersForType(PIXEL, { limit: 1 })
  if (orders.empty) {
    return ERR_NOT_FOUND
  }

  // limit 1, skip index
  const sellOrder = orders[ORDER_SELL]
  const buyOrder = orders[ORDER_BUY]

  const lowestSellPrice = sellOrder.price
  const highestBuyPrice = buyOrder.price

  // if there is a crazy sale price
  if ((lowestSellPrice < highestBuyPrice) && (lowestSellPrice <= Game.market.credits)) {
    const canAfford = Math.floor(Game.market.credits / lowestSellPrice)
    const fromSellOrder = Math.min(sellOrder.amount, canAfford)
    const toBuyOrder = Math.min(buyOrder.amount, hasPixels)
    const amount = Math.min(fromSellOrder, toBuyOrder)

    // make sure crazy deal goes through...
    const rc = Game.market.deal(sellOrder.id, amount)
    if (rc !== OK) {
      return rc
    }

    // offset it, if possible
    return Game.market.deal(buyOrder.id, amount)
  }

  const wantToSell = hasPixels - PIXELS_TO_KEEP
  if (wantToSell <= 0) {
    return ERR_NOT_ENOUGH_RESOURCES
  }

  // there are no crazy and/or affordable prices
  const howLowToSell = lowestSellPrice * (1.0 - PIXELS_DISCOUNT)
  if (highestBuyPrice >= howLowToSell) {
    const amount = Math.min(buyOrder.amount, wantToSell)
    const rc = Game.market.deal(buyOrder.id, amount)
    if (rc === OK) {
      storePriceToMemory(PIXEL, buyOrder.price)
    }

    return rc
  }

  return ERR_NOT_IN_RANGE
}

const cancelCompletedOrders = function () {
  for (const order of Game.valueOrders) {
    if (order.remainingAmount === 0) {
      Game.market.cancelOrder(order.id)
    }
  }
}
const generatePixel = function () {
  if (!IS_SIM) {
    return Game.cpu.generatePixel()
  }

  return ERR_BUSY
}

const performTrading = function () {
  for (const room of Game.valueRooms) {
    if (!room.controller || !room.controller.my) continue
    if (!room.terminal || room.terminal.cooldown) continue

    if (performRoomTrading(room) === OK) return
  }

  performPixelTrading()

  cancelCompletedOrders()

  generatePixel()
}

const clearMemory = function () {
  Memory.creeps = undefined
  Memory.flags = undefined
  Memory.spawns = undefined

  for (const roomName in Memory.rooms) {
    if (Game.rooms[roomName]) {
      Memory.rooms[roomName] = _.pick(
        Memory.rooms[roomName],
        [
          'maxLevel'
        ]
      )
    } else {
      Memory.rooms[roomName] = undefined
    }
  }
}

module.exports.loop = function () {
  makeShortcuts()

  handleEventLogs() // first because activates safe mode
  handleStates() // second because set flags used in other code
  controlCreeps()
  performAutobuild()
  performTrading()

  clearMemory()
}
