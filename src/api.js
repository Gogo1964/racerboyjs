const configManager = require('./configManager');
const raceEngine = require('./race-engine'); // we will implement this next

module.exports = function setupAPI(app) {
  // Get Configuration
  app.get('/api/config', (req, res) => {
    res.json(configManager.get());
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
        case 'setGlobalPower':
          raceEngine.setGlobalPower(payload.power);
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
