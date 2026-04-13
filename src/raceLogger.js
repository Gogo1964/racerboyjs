const fs = require('fs');
const path = require('path');

class RaceLogger {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.activeLogFile = null;
    this.currentRaceConfig = null;
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
      const timeMs = stat.mtime ? stat.mtime.getTime() : 0;
      if (timeMs < oldestTime) {
        oldestTime = timeMs;
        oldestFile = file;
      }
    }
    return oldestFile;
  }

  startRace(config, lanesState) {
    this.currentRaceConfig = config;
    this.activeLogFile = this.getNextLogFile();
    
    const d = new Date();
    const dateStr = d.toISOString().replace('T', ' ').substring(0, 19);
    
    let header = `====================================================\n`;
    header += `                 RACE PROTOCOL\n`;
    header += `Started: ${dateStr} (UTC)\n`;
    header += `Heats Count: ${config.heats || 4}\n`;
    header += `Heat Duration: ${config.heatDurationSec} sec\n`;
    
    let modeText = 'Average Lap Time';
    if (config.distanceCalculationMode === 'last-lap') modeText = 'Last Complete Lap Time';
    if (config.distanceCalculationMode === 'final-lap') modeText = 'Final Coast-down Lap Time';
    header += `Distance Mode: ${modeText}\n`;
    
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
    
    // Filter out low-level hardware traces if verbose logging is explicitly disabled
    if (message.startsWith('TRACE:') && (!this.currentRaceConfig || !this.currentRaceConfig.verboseRaceLog)) {
        return;
    }
    
    const d = new Date();
    const ts = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    fs.appendFileSync(this.activeLogFile, `[${ts}] ${message}\n`);
  }
}

module.exports = new RaceLogger();
