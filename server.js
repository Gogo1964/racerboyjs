const express = require('express');
const http = require('http');
const path = require('path');
const setupAPI = require('./src/api');
const { setupWebSocket } = require('./src/websocket');

const app = express();
const server = http.createServer(app);

app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Set up HTTP API
setupAPI(app);

// Set up WebSockets
setupWebSocket(server);

// Fallback routing for SPA or direct HTML connections
app.get('/', (req, res) => {
  res.redirect('/training.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Racerboy Server running on port ${PORT}`);
});
