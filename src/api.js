const configManager = require('./configManager');
const raceEngine = require('./race-engine');
const fs = require('fs');
const path = require('path');

const DRIVERS_FILE = path.join(__dirname, '..', 'drivers.json');

function getDrivers() {
  if (!fs.existsSync(DRIVERS_FILE)) {
    const defaultDrivers = ["Driver 1", "Driver 2"];
    fs.writeFileSync(DRIVERS_FILE, JSON.stringify(defaultDrivers));
    return defaultDrivers;
  }
  try {
    return JSON.parse(fs.readFileSync(DRIVERS_FILE, 'utf8'));
  } catch (e) {
    return ["Driver 1", "Driver 2"];
  }
}

function addDriver(name) {
  const drivers = getDrivers();
  if (!drivers.includes(name)) {
    drivers.push(name);
    fs.writeFileSync(DRIVERS_FILE, JSON.stringify(drivers));
  }
}

module.exports = function setupAPI(app) {
  // Get Configuration
  app.get('/api/config', (req, res) => {
    res.json(configManager.get());
  });

  // Get Drivers
  app.get('/api/drivers', (req, res) => {
    res.json(getDrivers());
  });

  // Update Configuration
  app.post('/api/config', (req, res) => {
    try {
      configManager.update(req.body);
      // Let the race engine know config might have changed
      raceEngine.applyConfig(configManager.get());
      res.json({ success: true, config: configManager.get() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Get current race state
  app.get('/api/state', (req, res) => {
    res.json(raceEngine.getState());
  });

  // Action commands
  app.post('/api/action', (req, res) => {
    const { action, payload } = req.body;
    try {
      switch (action) {
        case 'setMode':
          raceEngine.setMode(payload.mode); // 'training' or 'race'
          break;
        case 'startRace':
          raceEngine.startRace();
          break;
        case 'pauseRace':
          raceEngine.pauseRace();
          break;
        case 'resumeRace':
          raceEngine.resumeRace();
          break;
        case 'stopRace':
          raceEngine.stopRace();
          break;
        case 'resetLaps':
          raceEngine.resetLaps();
          break;
        case 'mockLap':
          // used for testing on Mac
          raceEngine.hardware.mockLapTrigger(payload.laneId);
          break;
        case 'adjustLap':
          raceEngine.adjustLap(payload.laneId, payload.delta);
          break;
        case 'setCrashed':
          raceEngine.setCrashed(payload.laneId, payload.isCrashed);
          break;
        case 'setGlobalPower':
          raceEngine.setGlobalPower(payload.power);
          break;
        case 'toggleLanePower':
          {
             const lane = raceEngine.state.lanes[payload.laneId];
             if (lane) {
                 const newPower = !lane.isPowerOn;
                 raceEngine.hardware.setLanePower(payload.laneId, newPower);
                 raceEngine.emitStateChanged();
             }
          }
          break;
        case 'setDriverName':
          {
             const newName = payload.name.trim();
             if (newName) {
                 addDriver(newName);
                 raceEngine.setDriverName(payload.laneId, newName);
             }
          }
          break;
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
