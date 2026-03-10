const http = require('http');

function post(action, payload) {
  return new Promise(resolve => {
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/action', method: 'POST', headers: {'Content-Type': 'application/json'} }, (res) => { res.on('data', ()=>{}); resolve(); });
    req.write(JSON.stringify({ action, payload }));
    req.end();
  });
}

async function run() {
  await post('setMode', {mode: 'race'});
  await post('stopRace'); // reset
  
  // Heat 1
  await post('startRace');
  await new Promise(r => setTimeout(r, 6000)); // wait for lights
  await post('mockLap', {laneId: 1}); // start timer
  await post('mockLap', {laneId: 2}); // start timer
  await new Promise(r => setTimeout(r, 10000)); // wait for heat
  await post('mockLap', {laneId: 1}); // finish lap
  await post('mockLap', {laneId: 2}); // finish lap
  
  console.log('--- Heat 1 Over ---');
  
  // Heat 2
  await new Promise(r => setTimeout(r, 2000));
  await post('startRace');
  
  console.log('Done test dispatch');
}

run();
