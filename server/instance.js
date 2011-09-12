var ObjectID = require('mongodb').ObjectID,
    Entity = require("./entity.js").Entity;

// A function that just eats events (called when updating the database)
function sink(err, result) {
  if(err) {
    console.log(err);
  }
}

//----------------------------------------------------------------
// A player connection
//----------------------------------------------------------------
function Player(player_rec, entity) {

  //Player record  
  this.player_id = player_id;
  this.entity    = entity;
  
  //Input from client
  this.client_state = {};
  
  //Entity replication information
  this.cached_entities = {};
  this.pending_entity_updates = {};
  this.pending_entity_deletes = {};
}

Player.prototype.init = function() {
  this.update_interval = setInterval(this.pushUpdates, 50);
}

Player.prototype.deinit = function() {
  this.clearInterval(this.update_interval);
}

//Deletes an entity on the client
Player.prototype.deleteEntity = function(entity) {
  var entity_id = entity.state._id;
  if(entity_id in this.cached_entities) {
    delete this.cached_entities[entity_id];
  }
  if(entity_id in this.pending_entity_updates) {
    delete this.pending_entity_updates[entity_id];
  }
  this.pending_entity_deletes[entity_id] = true;
}

//Marks an entity for getting updated
Player.prototype.updateEntity = function(entity) {
  this.pending_entity_updates[entity.state._id] = true;
}

//Pushes updates to the player over the network
Player.prototype.pushUpdates = function() {

  //FIXME: Push entity updates here

  this.pending_entity_updates = {};
  this.pending_entity_deletes = {};
}

//----------------------------------------------------------------
// An Instance is a process that simulates a region in the game.
// It keeps a local copy of all entities within the region.
//----------------------------------------------------------------
function Instance(region, db, gateway, rules) {
  this.entities   = {};
  this.players    = {};
  this.region     = region;
  this.db         = db;
  this.running    = false;
  this.gateway    = gateway;
  this.rules      = rules;
}

//Start the instance server
Instance.prototype.start = function(cb) {  

  //Clear out local object cache
  this.entities = {};
  this.players = {};
  
  //Reset message queues
  this.dirty_entities = [];
  this.deleted_entities = [];
  
  
  //Get ref to db
  var db    = this.db,
      inst  = this;

  //Thaw out all the objects
  db.entities.find({ region: inst.region._id }, function(err, cursor) {
    //Check for database error
    if(err) {
      cb(err);
      return;
    }
    
    //Iterate over result set
    cursor.each(function(err, entity) {
      if(err !== null) {
        cb(err);
      } else if(entity !== null) {
        //Do not instantiate player entities until they actually connect
        if(entity.type && entity.type == 'player') {
          return;
        }
        entities[entity._id] = inst.createEntity(entity);
      } else {
      
        //Start running
        inst.running = true;
      
        //Initialize all the entities
        for(var id in inst.entities) {
          inst.entities[id].init();
          inst.updateEntity(inst.entities[id]);
        }
      
        //Set up interval counters
        inst.tick_interval = setInterval( function() { inst.tick(); }, 50);
        inst.sync_interval = setInterval( function() { inst.sync(); }, 10000);
        
        
        //Continue
        cb(null);
      }      
    });
  });
}

//Stops a running instance
Instance.prototype.stop = function(callback) {

  //Kick all the players
  for(var player_id in this.players) {
    this.kickPlayer(this.players[player_id]);
  }

  //Stop clocks
  clearInterval(this.tick_interval);
  clearInterval(this.sync_interval);
  
  
  //Stop all the entities and save them to the database
  for(var id in this.entities) {
    this.entities[id].deinit();
    this.db.entities.save(entities[id].state, sink);
  }
}

//Tick all the entities in the game world
Instance.prototype.tick = function() {
  var id, ent;
  for(id in this.entities) {
    ent = this.entities[id];
    if(!ent.active || ent.deleted)
      continue;
    ent.tick();
  }
  
  //Check for any entities that got modified (need to do this after all ticks are complete)
  for(id in this.entities) {
    ent = this.entities[id];
    
    //If the entity does not need to be checked, don't do it.
    if(ent.deleted || (!(ent.persistent && !dirty) && !ent.net_replicated)) {
      continue;
    }
      
    //Check if entity got modified, do copy on write
    if(ent.checkModified()) {
      this.updateEntity(ent);
    }
  }
}

//Creates an entity from the state
Instance.prototype.createEntity = function(state) {

  //Generate entity id if needed
  if(!("_id" in state)) {
    state["_id"] = new ObjectID();
  }
  
  //Create the entity and register it
  var entity = new Entity(this, state);
  this.entities[entity.state._id] = entity;
  entity.state.region = this.region.region_id;
  
  //Add components to entity
  rules.initializeComponents(entity);
  
  //Initialize the entity if we are running
  if(running) {
    entity.init();
    this.updateEntity(entity);
  }
}

//Looks up an entity in this region
Instance.prototype.lookupEntity = function(entity_id) {
  var e = entities[entity_id];
  if(e && !e.deleted) {
    return e;
  }
  return null;
}

//Destroy an entity
Instance.prototype.destroyEntity = function(entity_id) {
  if(!(entity_id in entities)) {
    return;
  }
  
  var entity = entities[entity_id];
  if(!entity || entity.deleted) {
    return;
  }
  
  entity.deinit();
  entity.deleted = true;
  this.deleted_entities.push(entity.state._id);
}

//Called whenever an entity's state changes
Instance.prototype.updateEntity = function(entity) {
  if(!entity || entity.deleted) {
    return;
  }
  
  if(!entity.dirty) {
    this.dirty_entities.push(entity);
  }
  
  //Mark entity in each player
  if(entity.net_replicated) {
    for(var player_id in this.players) {
      this.players[player_id].updateEntity(entity);
    }
    
    //If entity is one-shot, only replicate it once
    if(entity.net_one_shot) {
      entity.net_replicated = false;
    }
  }
}

//Synchronize with the database
Instance.prototype.sync = function() {
  var e;
  for(var i=0; i<this.dirty_entities.length; ++i) {
    e = this.entities[this.dirty_entities[i]];
    if(!e.deleted) {
      this.db.entities.save(e.state, sink);
      e.dirty = false;
    }
  }
  this.dirty_entities.length = 0;

  for(var i=0; i<this.deleted_entities.length; ++i) {
    this.db.entities.remove({id: this.deleted_entities[i]}, sink);
  }
  this.deleted_entities.length = 0;
}


//Called when a player enters the instance
Instance.prototype.activatePlayer = function(player_rec, cb) {
  
  if((player_rec.entity_id in this.entities) ||
     (player_rec._id in this.players) ) {
    cb("Player already in instance");
    return;
  }
  
  //Extract player entity from database
  var instance = this;
  this.db.entities.find({ _id:player_rec.entity_id }, function(err, player_entity) {
  
    //Create the player entity
    var entity = instance.createEntity(player_entity);
    
    //Add to player list
    var player = new Player(player_rec, entity);
    this.players[player_rec._id] = player;
    player.start();
    
    //Done
    cb(null);
  });
}

//Called when a player leaves the instance
Instance.prototype.deactivatePlayer = function(player_id, cb) {
  
  //Remove from player list
  var player = this.players[player_id];
  if(!player) {
    cb("Player does not exist");
    return;
  }
  delete this.players[player_id];
  
  var entity_id = player.entity.state._id;
  
  //Remove player from dirty entity list
  for(var i=0; i<dirty_entities.length; ++i) {
    if(dirty_entities[i] == entity_id) {
      dirty_entities[i] = dirty_entities[dirty_entities.length-1];
      dirty_entities.length = dirty_entities.length -1;
    }
  }
  
  //Remove from entity list
  delete this.entities[entity_id];
  
  //Remove entity from all players
  for(var pl in this.players) {
    this.players[pl].deleteEntity(player.entity);
  }
  
  //Save entity changes to database, and continue
  this.db.entities.update(player.entity, function(err, doc) {
    cb(err);
  });
}

exports.Instance = Instance;
