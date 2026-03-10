const WebSocket = require('ws');
const raceEngine = require('./race-engine');

let wss;

function broadcast(type, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function setupWebSocket(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('WS Client connected');
    // On connect, immediately send the current full state
    ws.send(JSON.stringify({ type: 'fullState', payload: raceEngine.getState() }));
    
    ws.on('message', (message) => {
      // Future: client could send direct ws messages instead of HTTP API for actions
      console.log('received: %s', message);
    });

    ws.on('error', (err) => {
      console.log('WS Client Error:', err.message);
    });
  });

  // Listen to race engine events and broadcast
  raceEngine.on('stateChanged', () => {
    broadcast('stateUpdate', raceEngine.getState());
  });

  raceEngine.on('lapRecorded', (data) => {
    broadcast('lapRecorded', data);
  });
  
  raceEngine.on('penalty', (data) => {
    broadcast('penalty', data);
  });

  raceEngine.hardware.on('mockBeep', (data) => {
    broadcast('beep', data);
  });
}

module.exports = {
  setupWebSocket,
  broadcast
};
