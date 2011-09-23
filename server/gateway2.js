var util = require('util'),
    path = require('path'),
    ObjectID = require('mongodb').ObjectID,
    DNode = require('dnode'),
    Instance = require('./instance.js').Instance;

//--------------------------------------------------------------
// A client connection record
//--------------------------------------------------------------
function ClientConnection(session_id, rpc, conn) {
  this.session_id = session_id;
  this.rpc        = rpc;
  this.connection = conn;
  this.player_id  = null;
  this.instance   = null;
  this.state      = "prelogin";
}

//--------------------------------------------------------------
// The RPC interface which is exposed to the client
//--------------------------------------------------------------

//Session id counter (this is not exposed, just used internally)
var next_session_id = 0;


function validateInterface(rpc, methods) {
  //FIXME:
  //FIXME:  Validate client RPC interface here
  //FIXME:

  return true;
}

function ClientInterface(gateway) {
  return DNode(function(rpc_interface, connection) {

    //Reject bad RPC interface
    if(!validateInterface(rpc_interface, [
        'notifyLoadComplete',
        'updateEntities',
        'deleteEntities',
        'setVoxels',
        'updateChunks',
        'logHTML' ])) {
      
        connection.close();
        return;
     }

    //Add self to the client list on the server    
    var client = new ClientConnection(next_session_id++, rpc_interface, connection);
    gateway.clientConnect(client);

    //Bind any connection events
    connection.on('end', function() {
      gateway.clientDisconnect(client);
    });
    
    //Define the RPC interface
    this.joinGame = function(player_name, player_password, options, cb) {
    
      if(typeof(player_name) != "string" ||
         typeof(player_password) != "string" ||
         typeof(options) != "object" ||
         typeof(cb) != "function") {
       
        console.log("Got bad join request from client");
        return;  
      }
    
      if(client.state != "prelogin") {
        util.log("Got spam join event, discarding.  Session id = " + client.session_id + ", name = " + player_name);
        cb("Processing...");
        return;
      }
    
      client.state = "login";
    
      gateway.joinGame(
        client,
        player_name,
        player_password,
        options,
        function (err) {
          if(err) {
            client.state = "prelogin";
            cb(err);
          }
          else {
            client.state = "game";
            cb("");
          }
        });
    };
    
    //DEBUG: Temporary function for placing a block
    this.setVoxel = function(x, y, z, v) {
      client.instance.setVoxel(x,y,z,v);
    };
    
  });
}


//--------------------------------------------------------------
// The gateway object
//--------------------------------------------------------------
function Gateway(db, rules) {
  this.instances         = {};
  this.clients           = {};
  this.db                = db;
  this.rules             = rules;
  this.rules.registerGateway(this);
  
  //List of regions in the game
  this.regions           = {};
  
  //Create server last
  this.server     = ClientInterface(this);
}

Gateway.prototype.lookupRegion = function(region_name) {
  var region_id = this.regions[region_name];
  if(region_id) {
    return region_id;
  }
  return null;
}


//--------------------------------------------------------------
// Connection events
//--------------------------------------------------------------
Gateway.prototype.clientConnect = function(client) {
  util.log("Client connected: " + client.session_id);

  this.clients[client.session_id] = client;
}

Gateway.prototype.clientDisconnect = function(client) {
  util.log("Client disconnected: " + client.session_id);
  
  var gateway = this;

  function finalizeLogout(err) {
    if(err) {
      util.log("Error logging out client: " + err);
    }
    client.state = "disconnect";
    if(client.session_id in gateway.clients) {
      delete gateway.clients[client.session_id];
    }
  }

  if(client.state === "game") {
    client.instance.deactivatePlayer(client.player_id, finalizeLogout);
  } else {
    finalizeLogout(null);
  }
}

//--------------------------------------------------------------
// Player login
//--------------------------------------------------------------

Gateway.prototype.joinGame = function(client, player_name, password, options, cb) {
 
  //Validate
  if(player_name.length < 3 || player_name.length > 36 ||
     !(player_name.match(/^[0-9a-zA-Z]+$/))) {
     cb("Invalid player name");
     return;
  }
  if(password.length < 1 || password.length > 128) {
    cb("Invalid password");
    return;
  }
  
  util.log("Player joining: " + player_name);
  var gateway = this;

  //Handles the actual join event
  var handleJoin = function(player_rec, entity_rec) {

    if(client.state == "disconnect") {
      util.log('Client disconnected while logging in');
      return;
    }

    //Look up instance
    var region_id = entity_rec['region_id'];
    if(!region_id) {
      cb("Missing player region id");
      return;
    }
    var instance = gateway.instances[region_id];
    if(!instance) {
      cb("Player region does not exist!");
      return;
    }

    //Set player id
    client.player_id = player_rec._id;
    
    //Activate the player
    instance.activatePlayer(client, player_rec, entity_rec, function(err) {
      if(err) {
        cb("Error activating player: " + JSON.stringify(err));
        return;
      }
      cb(null);
    });
  };
  
  var handleError = function(err_mesg) {
    util.log("Error: " + err_mesg);
    cb(err_mesg);
  };
  
  this.db.players.findOne({ 'player_name': player_name }, function(err, player_rec) {
    if(player_rec) {
      if(player_rec.password == password) {
        util.log("Player connected: " + player_name);
        gateway.db.entities.findOne({ '_id': player_rec.entity_id }, function(err, entity_rec) {
          if(err) {
            handleError("Error locating player entity: " + JSON.stringify(err));
            return;
          }
          else if(entity_rec) {          
            handleJoin(player_rec, entity_rec);
          }
          else {
            handleError("Missing player entity");
          }
        });
      }
      else {
        handleError("Invalid password");
      }
    }
    else {
      //Assume player not found, then create record
      util.log("Creating new player: " + player_name);
      
      gateway.rules.createPlayer(player_name, password, options, function(err, player_rec, entity_rec) {
        if(err) {
          handleError("Error creating player entity: " + JSON.stringify(err));
          return;
        }
        handleJoin(player_rec, entity_rec);
      });
    }
  });
}


//--------------------------------------------------------------
// Gateway constructor
//--------------------------------------------------------------
exports.createGateway = function(server, db, rules, cb) {

  var gateway = new Gateway(db, rules);
  gateway.server.listen(server);
  
  //Start all of the regions
  db.regions.find({ }, function(err, cursor) {
    if(err) {
      util.log("Error loading regions: " + err);
      cb(err, null);
      return;
    }
    
    var num_regions = 0, closed = false;
    
    function check_finished() {
      if(num_regions == 0 && closed) {
        cb(null, gateway);
      }
    }
    
    cursor.each(function(err, region) {  
      if(err) {
        util.log("Error enumerating regions: " + err);
        cb(err, null);
        return;
      }
      else if(region !== null) {
      
        //Register region
        gateway.regions[region.region_name] = region._id;
      
        num_regions++;
        
        
        util.log("Starting region: " + JSON.stringify(region));
        
        //Start instance server
        var instance = new Instance(region, db, gateway, rules);
        instance.start(function(err) {
          num_regions--;
          if(err) {
            util.log("Error starting region instance: " + region + ", reason: " + err);
            check_finished();
          }
          else {
            util.log("Registered instance: " + JSON.stringify(region));
            gateway.instances[region._id] = instance;
            check_finished();
          }
        });
      }
      else {
        closed = true;
        check_finished();
      }
    });
  });
}
