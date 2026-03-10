const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');

class ConfigManager {
  constructor() {
    this.config = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        this.config = JSON.parse(data);
        console.log('Configuration loaded successfully.');
      } else {
        console.warn('Config file not found, creating default...');
        this.saveDefault();
      }
    } catch (err) {
      console.error('Failed to load configuration:', err);
    }
  }

  saveDefault() {
    this.config = {
      maxLapTimeMs: 60000,
      minLapTimeMs: 1000,
      heats: 4,
      heatDurationSec: 10,
      penaltyDurationSec: 3,
      trackLengthMeters: 25.5,
      distanceCalculationMode: "average", // or "last-lap"
      lane1: { name: "Driver 1", powerLevel: 100, color: "green", pins: { sensor: 17, power_fwd: 24, power_bwd: 23 } },
      lane2: { name: "Driver 2", powerLevel: 100, color: "blue", pins: { sensor: 18, power_fwd: 27, power_bwd: 22 } },
      lane3: { name: "Driver 3", powerLevel: 100, color: "red" },
      lane4: { name: "Driver 4", powerLevel: 100, color: "yellow" },
      lane5: { name: "Driver 5", powerLevel: 100, color: "purple" },
      lane6: { name: "Driver 6", powerLevel: 100, color: "orange" },
      lane7: { name: "Driver 7", powerLevel: 100, color: "white" },
      lane8: { name: "Driver 8", powerLevel: 100, color: "black" },
    };
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
      console.log('Configuration saved.');
    } catch (err) {
      console.error('Failed to save configuration:', err);
    }
  }

  get() {
    return this.config;
  }

  update(newConfig) {
    if (!newConfig) return;
    for (const key of Object.keys(newConfig)) {
      if (typeof newConfig[key] === 'object' && newConfig[key] !== null && !Array.isArray(newConfig[key])) {
        // Deep merge objects like lane1, lane2 to preserve hidden nested keys like `pins`
        this.config[key] = Object.assign({}, this.config[key] || {}, newConfig[key]);
      } else {
        this.config[key] = newConfig[key];
      }
    }
    this.save();
  }
}

module.exports = new ConfigManager();
