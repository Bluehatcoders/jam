import State from 'use-minimal-state';
import {authenticatedHub} from './signalhub';
import causalLog from './causal-log';
import {connectPeer, removePeer, addStreamToPeer, handleSignal} from './peer';

// public API starts here

const swarm = State({
  // state
  stickyPeers: {}, // {peerId: {lastFailure: number, hadStream: boolean}}
  myPeerId: null,
  connected: false,
  remoteStreams: [], // [{stream, name, peerId}], only one per (name, peerId) if name is set
  peerState: {}, // {peerId: sharedState}
  sharedState: null, // my portion of peerState, gets shared on update and on peer join
  // shared peer state can be authenticated by passing sign / verify functions to config()
  // internal
  peers: {},
  url: '',
  room: '',
  debug: false,
  hub: null,
  localStreams: {},
  // events
  stream: null,
  data: null,
  newPeer: null,
  sharedEvent: null,
  peerEvent: null,
  anonymous: null,
});

export default swarm;

function config({url, room, myPeerId, sign, verify, pcConfig, debug}) {
  if (url) swarm.url = url;
  if (room) swarm.room = room;
  if (myPeerId) swarm.myPeerId = myPeerId;
  if (sign) swarm.sign = sign; // sign(state): string
  if (verify) swarm.verify = verify; // verify(signedState, peerId): state | undefined
  if (pcConfig) swarm.pcConfig = pcConfig;
  if (debug) swarm.debug = debug;
}

function addLocalStream(stream, name) {
  log('addlocalstream', stream, name);
  if (!name) name = randomHex4();
  swarm.localStreams[name] = stream;
  try {
    for (let peerId in swarm.peers) {
      addStreamToPeer(swarm, peerId, stream, name);
    }
  } catch (err) {
    console.error('ERROR: add stream to peers');
    console.error(err);
  }
}

swarm.on('sharedState', data => {
  let {hub, myPeerId} = swarm;
  if (!hub || !myPeerId) return;
  hub.broadcast('all', {
    type: 'shared-state',
    peerId: myPeerId,
    data,
  });
});

swarm.on('sharedEvent', data => {
  let {hub, myPeerId} = swarm;
  if (!hub || !myPeerId) return;
  hub.broadcast('all', {
    type: 'shared-event',
    peerId: myPeerId,
    data,
  });
});

export {config, connect, disconnect, reconnect, addLocalStream};

swarm.config = config;
swarm.connect = connect;
swarm.disconnect = disconnect;
swarm.reconnect = reconnect;
swarm.addLocalStream = addLocalStream;

// public API ends here

function connect(room) {
  if (swarm.hub) return;
  swarm.config({room});
  if (!swarm.room || !swarm.url) {
    return console.error(
      'Must call swarm.config({url, room}) before connecting!'
    );
  }
  let myConnId = randomHex4();
  swarm.connId = myConnId;
  log('connecting. conn id', myConnId);
  let {myPeerId, sign, verify, sharedState} = swarm;
  let hub = authenticatedHub({
    room: swarm.room,
    url: swarm.url,
    myPeerId,
    sign,
    verify,
  });

  hub
    .broadcast('connect-me', {
      peerId: myPeerId,
      connId: myConnId,
      sharedState,
    })
    .then(() => {
      swarm.set('connected', true);
    })
    .catch(err => {
      console.error('error connecting to signalhub');
      console.error(err);
      disconnect();
    });

  hub.connId = myConnId;
  swarm.hub = hub;

  hub.subscribe('connect-me', ({peerId, connId, sharedState}) => {
    if (peerId === myPeerId) return;
    log('got connect-me');
    initializePeer(swarm, peerId, connId, sharedState);
    connectPeer(swarm, hub, peerId, connId);
  });

  hub.subscribe(
    `signal-${myPeerId}`,
    ({peerId, data, connId, yourConnId, sharedState}) => {
      log('signal received from', s(peerId), connId, data.type);
      initializePeer(swarm, peerId, connId, sharedState);
      handleSignal(swarm, {peerId, connId, yourConnId, data});
    }
  );

  hub.subscribe('all', ({type, peerId, data}) => {
    if (type === 'shared-state') {
      updatePeerState(swarm, peerId, data);
    }
    if (type === 'shared-event') {
      swarm.emit('peerEvent', peerId, data);
    }
  });
  hub.subscribeAnonymous('anonymous', data => {
    swarm.emit('anonymous', data);
  });
}

function disconnect() {
  let {hub, peers} = swarm;
  if (hub) hub.close();
  swarm.hub = null;
  swarm.connId = null;
  swarm.set('connected', false);
  for (let peerId in peers) {
    try {
      peers[peerId].destroy();
      removePeer(swarm, peerId);
    } catch (e) {}
  }
}

function reconnect() {
  disconnect();
  connect();
}

function randomHex4() {
  return ((Math.random() * 16 ** 4) | 0).toString(16).padStart(4, '0');
}

let s = id => id.slice(0, 2);

let log = (...a) => {
  if (!swarm.debug) return;
  let d = new Date();
  let time = `[${d.toLocaleTimeString('de-DE')},${String(
    d.getMilliseconds()
  ).padStart(3, '0')}]`;
  causalLog(time, ...a);
};

function initializePeer(swarm, peerId, connId, sharedState) {
  let {stickyPeers} = swarm;
  if (!stickyPeers[peerId]) {
    stickyPeers[peerId] = {
      hadStream: false,
      lastFailure: null,
    };
    swarm.update('stickyPeers');
    swarm.emit('newPeer', peerId);
  }
  stickyPeers[peerId].connId = connId;
  if (sharedState) updatePeerState(swarm, peerId, sharedState);
}

function updatePeerState(swarm, peerId, state) {
  swarm.peerState[peerId] = state;
  swarm.update('peerState');
}
