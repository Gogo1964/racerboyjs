const EventEmitter = require('events');
const hardware = require('./hardware');
const configManager = require('./configManager');
const raceLogger = require('./raceLogger');

class RaceEngine extends EventEmitter {
  constructor() {
    super();
    this.hardware = hardware;
    this.config = configManager.get();

    this.state = {
      mode: 'training', // or 'race'
      status: 'stopped', // 'stopped', 'starting', 'running', 'finishing_heat', 'finished'
      currentHeat: 1,
      totalHeats: this.config.heats || 4,
      timeRemainingMs: 0,
      lanes: {}
    };

    this.driverNames = { 
        1: this.config.lane1 ? this.config.lane1.name : "Driver 1", 
        2: this.config.lane2 ? this.config.lane2.name : "Driver 2" 
    };

    this.initLanes();

    // Track which lanes have finished their final cool-down lap
    this.finishedLanes = new Set();

    // Listen to hardware laps
    this.hardware.on('lapSensorTriggered', this.onLapSensor.bind(this));

    // Ticker for countdowns
    this.ticker = null;
    this.lastTickTime = null;

    // Apply initial hardware state based on boot mode
    if (this.state.mode === 'training') {
      this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, true));
    }
  }

  applyConfig(newConfig) {
    this.config = newConfig;
    this.state.totalHeats = this.config.heats || 4;
    this.emitStateChanged();
  }

  setDriverName(laneId, name) {
    this.driverNames[laneId] = name;
    const lane = Object.values(this.state.lanes).find(l => l.hwId === laneId);
    if (lane) {
      lane.name = name;
    }
    this.emitStateChanged();
  }

  initLanes() {
    // We map hw lane 1 -> logical lane 1 initially. 
    // In races, cars swap lanes after heats. 
    // For now, simple fixed mapping: logical 1 = hw 1, logical 2 = hw 2
    this.state.lanes = {};
    const laneIds = [1, 2]; // 2 lanes for GUI
    laneIds.forEach(id => {
      let lc = this.config[`lane${id}`];
      this.state.lanes[id] = {
        hwId: id,
        name: this.driverNames[id] || (lc ? lc.name : `Driver ${id}`),
        color: lc ? lc.color : (id === 1 ? 'green' : 'blue'),
        laps: 0,
        distanceEst: 0, // 0 to 1 percentage string or float
        lastLapTimeMs: 0,
        averageLapTimeMs: 0,
        bestLapTimeMs: Infinity,
        history: [], // last N laps
        bestLaps: [], // { lap: number, timeMs: number }
        lastSensorTick: 0,
        penaltyUntil: 0,
        isWinner: false,
        isCrashed: false
      };
    });
  }

  getState() {
    return this.state;
  }

  emitStateChanged() {
    // Sync hardware electrical state to frontend state before emission
    Object.values(this.state.lanes).forEach(lane => {
      const hwLane = this.hardware.lanes.find(l => l.id === lane.hwId);
      if (hwLane) {
        lane.isPowerOn = hwLane.isPowerOn;
      }
    });
    this.emit('stateChanged');
  }

  setGlobalPower(isOn) {
    this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, isOn));
    this.emitStateChanged();
  }

  setMode(mode) {
    if (this.state.status !== 'stopped') {
      this.stopRace();
    }
    this.state.mode = mode;
    this.initLanes();

    if (mode === 'training') {
      this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, true));
    } else {
      // Race mode: also supply power immediately so they can drive to start line
      this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, true));
    }

    this.emitStateChanged();
  }

  resetLaps() {
    Object.values(this.state.lanes).forEach(lane => {
      lane.laps = 0;
      lane.distanceEst = 0;
      lane.lastLapTimeMs = 0;
      lane.averageLapTimeMs = 0;
      lane.bestLapTimeMs = Infinity;
      lane.history = [];
      lane.bestLapTimeMs = Infinity;
      lane.history = [];
      lane.bestLaps = [];
      lane.lastSensorTick = 0;
      lane.penaltyUntil = 0;
      lane.isWinner = false;
      lane.isCrashed = false;
    });
    this.emitStateChanged();
  }

  adjustLap(laneId, delta) {
    const lane = Object.values(this.state.lanes).find(l => l.hwId === laneId);
    if (!lane) return;
    lane.laps += delta;
    if (lane.laps < 0) lane.laps = 0;
    this.emitStateChanged();
  }

  setCrashed(laneId, isCrashed) {
    const lane = Object.values(this.state.lanes).find(l => l.hwId === laneId);
    if (!lane) return;
    lane.isCrashed = isCrashed;

    if (this.state.mode === 'race') {
      raceLogger.logEvent(`Lane ${lane.hwId} (${lane.name}) was marked ${isCrashed ? 'CRASHED' : 'RESUMED'}.`);
    }

    if (isCrashed) {
      this.hardware.playSound('fanfareCrashed');
      if (this.state.status === 'running') {
        const allCrashed = Object.values(this.state.lanes).every(l => l.isCrashed);
        if (allCrashed) {
          this.state.timeRemainingMs = 0;
          this.triggerHeatEnd();
        }
      } else if (this.state.status === 'finishing_heat') {
        this.checkAllLanesFinished();
      }
    }

    this.emitStateChanged();
  }

  startRace() {
    if (this.state.status !== 'stopped') return;
    if (this.state.currentHeat > this.state.totalHeats) return;

    if (this.state.currentHeat === 1) {
      raceLogger.startRace(this.config, this.state.lanes);
      raceLogger.logEvent(`--- RACE PROTOCOL STARTED ---`);
      this.raceStartTimeMs = Date.now();
    }

    // Explicitly snap mode back to race if a background tab tampered it
    this.state.mode = 'race';

    // Reset sensor ticks so first crossing in the new heat starts the timer
    Object.values(this.state.lanes).forEach(lane => {
      lane.lastSensorTick = 0;
    });

    this.state.status = 'starting';

    // Turn ON power for all lanes so they can false-start during the countdown!
    this.hardware.lanes.forEach(l => {
      this.hardware.setLanePower(l.id, true);
    });

    this.emitStateChanged();

    // Start light sequence mimic
    this.startLightSequence()
      .then(() => {
        if (this.state.status === 'starting') {
          this.beginHeat();
        }
      });
  }

  stopRace() {
    if (this.state.status === 'stopped' || this.state.status === 'finished') {
      // Cancel ENTIRE race
      this.initLanes();
      this.state.currentHeat = 1;
      this.state.timeRemainingMs = 0;
    }

    if (this.state.mode === 'race' && this.state.status !== 'stopped') {
       raceLogger.logEvent(`Race Manually Stopped/Cancelled.`);
    }

    this.state.status = 'stopped';
    this.state.currentLight = 0;
    this.stopTicker();
    this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, false));
    this.emitStateChanged();
  }

  pauseRace() {
    if (this.state.status !== 'running') return;
    this.state.status = 'paused';
    this.stopTicker();
    this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, false));
    this.emitStateChanged();
  }

  resumeRace() {
    if (this.state.status !== 'paused') return;
    this.state.status = 'starting'; // Go back to countdown

    // Restore power so cars can false start during the resume countdown
    this.hardware.lanes.forEach(l => {
      this.hardware.setLanePower(l.id, true);
    });

    this.emitStateChanged();

    this.startLightSequence()
      .then(() => {
        if (this.state.status === 'starting') {
          this.beginHeat(true); // true = isResume
        }
      });
  }

  startLightSequence() {
    this.state.currentLight = 0;
    return new Promise(resolve => {
      let i = 1;
      const step = () => {
        if (this.state.status !== 'starting') return resolve();
        this.hardware.playSound('beepStartingLight');
        this.state.currentLight = i;
        this.emitStateChanged();

        setTimeout(() => {
          i++;
          if (i <= 5) step();
          else {
            this.state.currentLight = 0;
            resolve();
          }
        }, 1000);
      };
      step();
    });
  }

  beginHeat(isResume = false) {
    this.state.status = 'running';
    if (!isResume) {
      this.state.timeRemainingMs = this.config.heatDurationSec * 1000;
      raceLogger.logEvent(`--- Heat ${this.state.currentHeat} Started ---`);
    } else {
      raceLogger.logEvent(`Heat ${this.state.currentHeat} Resumed.`);
    }

    // Always reset the precise tick tracker so we don't subtract the massive paused gap
    this.lastTickTime = Date.now();

    // Enable power for non-penalized lanes
    const now = Date.now();
    Object.values(this.state.lanes).forEach(lane => {
      lane.isCrashed = false;
      
      if (lane.penaltyUntil > now) {
          // If they false-started during countdown, start the penalty officially NOW
          lane.penaltyUntil = now + (this.config.penaltyDurationSec * 1000);
      } else {
          // No penalty, give them power immediately
          this.hardware.setLanePower(lane.hwId, true);
      }
    });

    this.hardware.playSound('beepStartOfHeat');
    this.startTicker();
    this.emitStateChanged();
  }

  startTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 100); // 100ms precision
  }

  stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  tick() {
    if (this.state.status !== 'running' && this.state.status !== 'finishing_heat') return;

    const now = Date.now();
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;

    if (this.state.status === 'paused') return;

    this.state.timeRemainingMs -= dt;
    console.log(`[DEBUG TICK] dt: ${dt}, timeRemainingMs: ${this.state.timeRemainingMs}, status: ${this.state.status}`);

    // Check penalties (mostly relevant in running, but harmless here)
    Object.values(this.state.lanes).forEach(lane => {
      if (lane.penaltyUntil > 0 && lane.penaltyUntil <= now) {
        lane.penaltyUntil = 0;
        this.hardware.setLanePower(lane.hwId, true);
      }
    });

    if (this.state.timeRemainingMs <= 0 && this.state.status === 'running') {
      // Don't snap to zero, so we can track negative "overtime"
      this.triggerHeatEnd();
    }

    this.emitStateChanged(); // Could optimize to avoid spamming every 100ms
  }

  triggerHeatEnd() {
    this.state.status = 'finishing_heat';
    this.finishedLanes.clear();
    this.heatEndTimeMs = Date.now();
    this.hardware.playSound('beepHeatTimeout');
    raceLogger.logEvent(`Heat Time Over! Waiting for cars to coast to finish line...`);

    // We wait for them to finish the lap to determine precise distanceEst in onLapSensor

    this.checkAllLanesFinished();
    this.emitStateChanged();
  }

  checkAllLanesFinished() {
    const allFinished = Object.values(this.state.lanes).every(l => this.finishedLanes.has(l.hwId) || l.isCrashed);
    if (allFinished) {
      this.completeHeat();
    }
  }

  completeHeat() {
    this.stopTicker();
    
    this.hardware.playSound('fanfareHeatFinished');

    raceLogger.logEvent(`Heat ${this.state.currentHeat} Completed. Current Laps: ` + Object.values(this.state.lanes).map(l => `Lane ${l.hwId} (${l.name}): ${(l.laps + (l.distanceEst || 0)).toFixed(2)}`).join(' | '));

    // Safety guarantee: Ensure power is explicitly cut for ALL lanes now that the heat is fully over
    // We add a tiny delay to allow any finishing car to coast past the finish line
    setTimeout(() => {
      if (this.state.status === 'stopped' || this.state.status === 'finished') {
        this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, false));
      }
    }, 1500);

    this.state.currentHeat++;
    if (this.state.currentHeat > this.state.totalHeats) {
      this.state.status = 'finished';
      raceLogger.logEvent(`ALL HEATS COMPLETED. Race Finished!`);
      this.determineWinner();
    } else {
      this.state.status = 'stopped';
      this.rotateLanes();
    }

    this.emitStateChanged();
  }

  determineWinner() {
    // Find lane with most laps. If tie, could use distanceEst
    let winnerId = null;
    let maxScore = -1;
    Object.values(this.state.lanes).forEach(l => {
      const score = l.laps + (l.distanceEst || 0);
      if (score > maxScore) {
        maxScore = score;
        winnerId = l.hwId;
      }
    });
    // Mark winner in state
    Object.values(this.state.lanes).forEach(l => {
      l.isWinner = (l.hwId === winnerId);
    });

    const winnerLane = Object.values(this.state.lanes).find(l => l.hwId === winnerId);
    
    let summary = `\n====================================================\n`;
    summary += `                 RACE SUMMARY\n`;
    summary += `----------------------------------------------------\n`;
    summary += `Total Heats: ${this.state.totalHeats}\n`;
    if (this.raceStartTimeMs) {
        const durSec = ((Date.now() - this.raceStartTimeMs) / 1000).toFixed(1);
        summary += `Total Race Duration: ${durSec} sec\n`;
    }
    summary += `\nFinal Standings:\n`;
    
    const sortedLanes = Object.values(this.state.lanes).sort((a, b) => (b.laps + (b.distanceEst || 0)) - (a.laps + (a.distanceEst || 0)));
    
    sortedLanes.forEach((l, idx) => {
        const score = (l.laps + (l.distanceEst || 0)).toFixed(2);
        summary += `  ${idx + 1}. ${l.name} (Lane ${l.hwId})\n`;
        summary += `     Total Laps: ${score}\n`;
        summary += `     Best Lap: ${l.bestLapTimeMs === Infinity ? 'N/A' : (l.bestLapTimeMs/1000).toFixed(3) + 's'}\n`;
        summary += `     Avg Lap: ${l.averageLapTimeMs === 0 ? 'N/A' : (l.averageLapTimeMs/1000).toFixed(3) + 's'}\n\n`;
    });
    
    if (winnerLane) {
        summary += `WINNER: ${winnerLane.name}!!!\n`;
    }
    summary += `====================================================`;
    
    raceLogger.logEvent(summary);

    if (winnerId !== null) {
      setTimeout(() => {
        this.hardware.playSound(`theWinnerIsOnLane${winnerId}`);
      }, 1000);
    }
  }

  rotateLanes() {
    // We want to physically swap the drivers on the lanes.
    // e.g., if lane 1 had "Driver A" and lane 2 had "Driver B",
    // now lane 1 gets "Driver B" and lane 2 gets "Driver A".
    // We swap the *contents* of the lane objects but keep `hwId` stable.

    const hwIds = Object.keys(this.state.lanes).map(Number).sort((a, b) => a - b);
    if (hwIds.length < 2) return;

    // Store original data
    const oldData = {};
    hwIds.forEach(id => {
      oldData[id] = Object.assign({}, this.state.lanes[id]);
    });

    // Shift data: Driver in lane N goes to lane N+1
    for (let i = 0; i < hwIds.length; i++) {
      const currentId = hwIds[i];
      const prevId = hwIds[(i - 1 + hwIds.length) % hwIds.length];

      // Target lane gets the prev lane's driver data
      const oldState = oldData[prevId];

      // Re-assign everything EXCEPT hwId and lastSensorTick
      this.state.lanes[currentId] = Object.assign({}, oldState, {
        hwId: currentId,
        lastSensorTick: 0
      });
    }
  }

  onLapSensor(data) {
    const { laneId, tick } = data; // tick is in microseconds (pigpio)
    const nowMs = Date.now(); // fallback to ms

    const laneObj = Object.values(this.state.lanes).find(l => l.hwId === laneId);
    if (!laneObj) return;

    if (this.state.mode === 'race') {
      raceLogger.logEvent(`ATT: Hardware Sensor Triggered - Lane ${laneId} (${laneObj.name})`);
    }

    // False start check during 'starting'
    if (this.state.mode === 'race' && this.state.status === 'starting') {
      // PENALTY!
      if (laneObj.penaltyUntil <= nowMs) {
          // Set to infinity basically, so it blocks them until beginHeat() trims it back to reality
          laneObj.penaltyUntil = nowMs + 1000000;
          raceLogger.logEvent(`PENALTY! Lane ${laneId} (${laneObj.name}) false started.`);
          this.hardware.setLanePower(laneId, false);
          this.emit('penalty', { laneId });
          this.emitStateChanged();
      }
      return;
    }

    if (this.state.mode === 'race' && laneObj.penaltyUntil > nowMs) {
      // Ignore sensor hits while the car is completely dead due to penalty
      return;
    }

    // Heat is over, cars are returning to start line
    if (this.state.status === 'finishing_heat' || this.state.status === 'finished') {
      if (!this.finishedLanes.has(laneId)) {
        if (laneObj.lastSensorTick === 0) {
          // They never started
          this.finishedLanes.add(laneId);
          raceLogger.logEvent(`Lane ${laneId} (${laneObj.name}) finished the heat. (0 Laps / DNS)`);
          this.hardware.setLanePower(laneId, false);
          this.checkAllLanesFinished();
          return;
        }

        const L = nowMs - laneObj.lastSensorTick;
        if (L < this.config.minLapTimeMs) return; // Debounce

        this.finishedLanes.add(laneId);
        raceLogger.logEvent(`Lane ${laneId} (${laneObj.name}) finished the heat.`);
        this.hardware.setLanePower(laneId, false);

        const T = this.heatEndTimeMs - laneObj.lastSensorTick;
        if (T > 0 && L > 0) {
          let referenceTime = laneObj.averageLapTimeMs;
          if (this.config.distanceCalculationMode === 'last-lap' || referenceTime === 0) {
            referenceTime = L;
          }
          if (referenceTime > 0) {
            let fraction = T / referenceTime;
            if (fraction > 1.0) fraction = 1.0;
            laneObj.distanceEst += fraction;

            while (laneObj.distanceEst >= 1.0) {
              laneObj.laps++;
              laneObj.distanceEst -= 1.0;
            }
          }
        }

        this.checkAllLanesFinished();
        this.emitStateChanged();
      }
      return; // Do not record the physical lap time in normal arrays
    }

    if (this.state.status !== 'running' && this.state.mode === 'race') {
      // Just safeguard
      this.hardware.setLanePower(laneId, false);
      return;
    }

    if (this.state.mode === 'race' && laneObj.isCrashed) {
      return; // Do not count laps for crashed cars in race mode
    }

    // Normal lap logic
    if (laneObj.lastSensorTick === 0) {
      laneObj.lastSensorTick = nowMs;
      return; // first cross = start
    }

    const lapTimeMs = nowMs - laneObj.lastSensorTick;

    // Jitter/debounce filter
    if (lapTimeMs < this.config.minLapTimeMs) return;

    // Record lap
    laneObj.lastSensorTick = nowMs;

    // Slow lap filter
    if (this.state.mode === 'training' && lapTimeMs > this.config.maxLapTimeMs) return;

    laneObj.laps++;
    laneObj.lastLapTimeMs = lapTimeMs;
    laneObj.history.push(lapTimeMs);
    if (laneObj.history.length > 10) laneObj.history.shift();

    laneObj.bestLaps.push({ lap: laneObj.laps, timeMs: lapTimeMs });
    laneObj.bestLaps.sort((a, b) => a.timeMs - b.timeMs);
    if (laneObj.bestLaps.length > 10) laneObj.bestLaps.pop();

    laneObj.averageLapTimeMs = laneObj.history.reduce((a, b) => a + b, 0) / laneObj.history.length;

    let isPb = false;
    if (lapTimeMs < laneObj.bestLapTimeMs) {
      laneObj.bestLapTimeMs = lapTimeMs;
      isPb = true;
    }

    if (this.state.mode === 'race') {
      raceLogger.logEvent(`Lap Recorded - Lane ${laneId} (${laneObj.name}): Lap ${laneObj.laps} | Time: ${(lapTimeMs/1000).toFixed(3)}s | Avg: ${(laneObj.averageLapTimeMs/1000).toFixed(3)}s`);
    }

    this.emit('lapRecorded', { laneId, lapTimeMs, isPb });
    this.emitStateChanged();
  }
}

module.exports = new RaceEngine();
