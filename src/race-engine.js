const EventEmitter = require('events');
const hardware = require('./hardware');
const configManager = require('./configManager');

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

    this.initLanes();
    
    // Track which lanes have finished their final cool-down lap
    this.finishedLanes = new Set();
    
    // Listen to hardware laps
    this.hardware.on('lapSensorTriggered', this.onLapSensor.bind(this));
    
    // Ticker for countdowns
    this.ticker = null;
    this.lastTickTime = null;
  }

  applyConfig(newConfig) {
    this.config = newConfig;
    this.state.totalHeats = this.config.heats || 4;
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
        name: lc ? lc.name : `Driver ${id}`,
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
        isWinner: false
      };
    });
  }

  getState() {
    return this.state;
  }

  emitStateChanged() {
    this.emit('stateChanged');
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
      this.hardware.lanes.forEach(l => this.hardware.setLanePower(l.id, false));
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
    });
    this.emitStateChanged();
  }

  startRace() {
    if (this.state.status !== 'stopped') return;
    if (this.state.currentHeat > this.state.totalHeats) return;
    
    // Explicitly snap mode back to race if a background tab tampered it
    this.state.mode = 'race';
    
    // Reset sensor ticks so first crossing in the new heat starts the timer
    Object.values(this.state.lanes).forEach(lane => {
      lane.lastSensorTick = 0;
    });
    
    this.state.status = 'starting';
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
        this.hardware.beep(100);
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
    }
    
    // Always reset the precise tick tracker so we don't subtract the massive paused gap
    this.lastTickTime = Date.now();
    
    // Enable power for non-penalized lanes
    const now = Date.now();
    Object.values(this.state.lanes).forEach(lane => {
        if (lane.penaltyUntil <= now) {
            this.hardware.setLanePower(lane.hwId, true);
        }
    });

    this.hardware.beep(500); // long beep
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
    if (this.state.status !== 'running') return;
    
    const now = Date.now();
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;
    
    if (this.state.status === 'paused') return;
    
    this.state.timeRemainingMs -= dt;
    console.log(`[DEBUG TICK] dt: ${dt}, timeRemainingMs: ${this.state.timeRemainingMs}, status: ${this.state.status}`);

    // Check penalties
    Object.values(this.state.lanes).forEach(lane => {
      if (lane.penaltyUntil > 0 && lane.penaltyUntil <= now) {
        lane.penaltyUntil = 0;
        this.hardware.setLanePower(lane.hwId, true);
      }
    });

    if (this.state.timeRemainingMs <= 0 && this.state.status === 'running') {
      this.state.timeRemainingMs = 0;
      this.triggerHeatEnd();
    }
    
    this.emitStateChanged(); // Could optimize to avoid spamming every 100ms
  }

  triggerHeatEnd() {
    this.state.status = 'finishing_heat';
    this.finishedLanes.clear();
    this.heatEndTimeMs = Date.now();
    this.hardware.beep(1000); // long beep to signal time up
    
    // We wait for them to finish the lap to determine precise distanceEst in onLapSensor
    
    this.checkAllLanesFinished();
    this.emitStateChanged();
  }

  checkAllLanesFinished() {
    const allFinished = Object.values(this.state.lanes).every(l => this.finishedLanes.has(l.hwId));
    if (allFinished) {
      this.completeHeat();
    }
  }

  completeHeat() {
    this.stopTicker();
    
    this.state.currentHeat++;
    if (this.state.currentHeat > this.state.totalHeats) {
      this.state.status = 'finished';
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
        const score = l.laps + l.distanceEst;
        if (score > maxScore) {
             maxScore = score;
             winnerId = l.hwId;
        }
    });
    // Mark winner in state
    Object.values(this.state.lanes).forEach(l => {
         l.isWinner = (l.hwId === winnerId);
    });
  }

  rotateLanes() {
    // We want to physically swap the drivers on the lanes.
    // e.g., if lane 1 had "Driver A" and lane 2 had "Driver B",
    // now lane 1 gets "Driver B" and lane 2 gets "Driver A".
    // We swap the *contents* of the lane objects but keep `hwId` stable.
    
    const hwIds = Object.keys(this.state.lanes).map(Number).sort((a,b)=>a-b);
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

    // False start check during 'starting'
    if (this.state.mode === 'race' && this.state.status === 'starting') {
      // PENALTY!
      laneObj.penaltyUntil = Date.now() + (this.config.penaltyDurationSec * 1000);
      this.hardware.setLanePower(laneId, false);
      this.emit('penalty', { laneId });
      this.emitStateChanged();
      return;
    }

    // Heat is over, cars are returning to start line
    if (this.state.status === 'finishing_heat' || this.state.status === 'finished') {
      if (!this.finishedLanes.has(laneId)) {
         if (laneObj.lastSensorTick === 0) {
             // They never started
             this.finishedLanes.add(laneId);
             this.hardware.setLanePower(laneId, false);
             this.checkAllLanesFinished();
             return;
         }

         const L = nowMs - laneObj.lastSensorTick;
         if (L < this.config.minLapTimeMs) return; // Debounce

         this.finishedLanes.add(laneId);
         this.hardware.setLanePower(laneId, false); // Cut power as soon as they cross

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
    if (lapTimeMs > this.config.maxLapTimeMs) return;

    laneObj.laps++;
    laneObj.lastLapTimeMs = lapTimeMs;
    laneObj.history.push(lapTimeMs);
    if (laneObj.history.length > 10) laneObj.history.shift();
    
    laneObj.bestLaps.push({ lap: laneObj.laps, timeMs: lapTimeMs });
    laneObj.bestLaps.sort((a,b) => a.timeMs - b.timeMs);
    if (laneObj.bestLaps.length > 10) laneObj.bestLaps.pop();
    
    laneObj.averageLapTimeMs = laneObj.history.reduce((a,b)=>a+b,0) / laneObj.history.length;
    
    let isPb = false;
    if (lapTimeMs < laneObj.bestLapTimeMs) {
      laneObj.bestLapTimeMs = lapTimeMs;
      isPb = true;
      if (this.state.mode === 'training') {
        this.hardware.beep(100); // short beep for PB
      }
    }

    this.emit('lapRecorded', { laneId, lapTimeMs, isPb });
    this.emitStateChanged();
  }
}

module.exports = new RaceEngine();
