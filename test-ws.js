const WebSocket = require('ws');
const http = require('http');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', () => {
    console.log('Connected');
    const req = http.request({
        hostname: 'localhost', port: 3000, path: '/api/action', method: 'POST', headers: {'Content-Type': 'application/json'}
    });
    req.write(JSON.stringify({ action: 'setMode', payload: { mode: 'race' } }));
    req.end();

    setTimeout(() => {
        const req2 = http.request({ hostname: 'localhost', port: 3000, path: '/api/action', method: 'POST', headers: {'Content-Type': 'application/json'} });
        req2.write(JSON.stringify({ action: 'startRace', payload: {} }));
        req2.end();
    }, 1000);
});
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'stateUpdate') {
        console.log('Status:', msg.payload.status, 'Time:', msg.payload.timeRemainingMs, 'Heat:', msg.payload.currentHeat);
    }
});
