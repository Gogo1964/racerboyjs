const fs = require('fs');
const path = require('path');

class RaceLogger {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.activeLogFile = null;
  }

  getNextLogFile() {
    let oldestFile = null;
    let oldestTime = Infinity;
    
    // Find missing or oldest file (0-9)
    for (let i = 0; i < 10; i++) {
      const file = path.join(this.dataDir, `racetrace${i}.txt`);
      if (!fs.existsSync(file)) {
        return file;
      }
      const stat = fs.statSync(file);
      if (stat.mtimeMs < oldestTime) {
        oldestTime = stat.mtimeMs;
        oldestFile = file;
      }
    }
    return oldestFile;
  }

  startRace(config, lanesState) {
    this.activeLogFile = this.getNextLogFile();
    
    const d = new Date();
    const dateStr = d.toISOString().replace('T', ' ').substring(0, 19);
    
    let header = `====================================================\n`;
    header += `                 RACE PROTOCOL\n`;
    header += `Started: ${dateStr} (UTC)\n`;
    header += `Heats Count: ${config.heats || 4}\n`;
    header += `Heat Duration: ${config.heatDurationSec} sec\n`;
    header += `----------------------------------------------------\n`;
    
    if (lanesState) {
        Object.values(lanesState).forEach(lane => {
            header += `Lane ${lane.hwId}: ${lane.name}\n`;
        });
    }
    header += `====================================================\n\n`;
    
    fs.writeFileSync(this.activeLogFile, header);
  }

  logEvent(message) {
    if (!this.activeLogFile) return;
    const d = new Date();
    const ts = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    fs.appendFileSync(this.activeLogFile, `[${ts}] ${message}\n`);
  }
}

module.exports = new RaceLogger();
