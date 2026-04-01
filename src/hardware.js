const EventEmitter = require('events');
const configManager = require('./configManager');

// Optional pigpio require. Will fail gracefully on MacOS
let Gpio;
let pigpioEnabled = false;

try {
  const pigpio = require('pigpio');
  Gpio = pigpio.Gpio;
  pigpioEnabled = true;
  console.log('Hardware detection: pigpio available. Operating in PRODUCTION mode.');
} catch (e) {
  console.log('Hardware detection: pigpio not available. Operating in MOCK mode.');
}

class Hardware extends EventEmitter {
  constructor() {
    super();
    const config = configManager.get();

    this.lanes = [
      { id: 1, sensorPin: 17, powerFwdPin: 24, powerBwdPin: 23, isPowerOn: false, speedLevel: 0 },
      { id: 2, sensorPin: 18, powerFwdPin: 27, powerBwdPin: 22, isPowerOn: false, speedLevel: 0 }
    ];

    // Override from config.json if defined
    this.lanes.forEach(lane => {
      const laneConfig = config[`lane${lane.id}`];
      if (laneConfig && laneConfig.pins) {
        if (laneConfig.pins.sensor !== undefined) lane.sensorPin = parseInt(laneConfig.pins.sensor, 10);
        if (laneConfig.pins.power_fwd !== undefined) lane.powerFwdPin = parseInt(laneConfig.pins.power_fwd, 10);
        if (laneConfig.pins.power_bwd !== undefined) lane.powerBwdPin = parseInt(laneConfig.pins.power_bwd, 10);
        if (laneConfig.pins.pwm !== undefined) lane.pwmPin = parseInt(laneConfig.pins.pwm, 10);
      }
    });

    this.buzzerPin = config.buzzerPin || 5;

    // Initialize actual hardware if available
    this.hardwareState = {};
    this.emiDebounceUntil = 0;
    
    if (pigpioEnabled) {
      this.initHardware();
    }
  }

  initHardware() {
    // Buzzer initialization
    this.hardwareState.buzzer = new Gpio(this.buzzerPin, { mode: Gpio.OUTPUT });
    this.hardwareState.buzzer.digitalWrite(0);

    // Lane initialization
    this.hardwareState.lanes = {};
    this.lanes.forEach(lane => {
      // Input sensor
      const sensor = new Gpio(lane.sensorPin, {
        mode: Gpio.INPUT,
        pullUpDown: Gpio.PUD_UP,
        edge: Gpio.FALLING_EDGE
      });

      // Hardware interrupt callback
      sensor.on('interrupt', (level, tick) => {
        if (Date.now() < this.emiDebounceUntil) {
           // Ignore electromagnetic interference spikes from relay switching
           return;
        }
        // debounce/jitter will be handled in race logic, just emit raw event here
        this.emit('lapSensorTriggered', { laneId: lane.id, tick });
      });

      // Forward Power Relay
      let powerFwd = null;
      if (lane.powerFwdPin) {
          powerFwd = new Gpio(lane.powerFwdPin, { mode: Gpio.OUTPUT });
          powerFwd.digitalWrite(0);
      }

      // Backward Power Relay
      let powerBwd = null;
      if (lane.powerBwdPin) {
          powerBwd = new Gpio(lane.powerBwdPin, { mode: Gpio.OUTPUT });
          powerBwd.digitalWrite(0);
      }

      // PWM for speed (Optional)
      let pwm = null;
      if (lane.pwmPin) {
        pwm = new Gpio(lane.pwmPin, { mode: Gpio.OUTPUT });
        pwm.pwmWrite(0);
      }

      this.hardwareState.lanes[lane.id] = { sensor, powerFwd, powerBwd, pwm };
    });
  }

  // --- API ---

  setLanePower(laneId, isOn) {
    // EMI blind spot: whenever a relay changes state, ignore lap sensors for 150ms
    this.emiDebounceUntil = Date.now() + 150;
    
    const lane = this.lanes.find(l => l.id === laneId);
    if (!lane) return;
    lane.isPowerOn = isOn;

    if (pigpioEnabled && this.hardwareState.lanes[laneId]) {
      const state = this.hardwareState.lanes[laneId];
      if (isOn) {
         // Power ON = FWD on, BWD off
         if (state.powerFwd) state.powerFwd.digitalWrite(1);
         if (state.powerBwd) state.powerBwd.digitalWrite(0);
      } else {
         // Power OFF = FWD off, BWD off
         if (state.powerFwd) state.powerFwd.digitalWrite(0);
         if (state.powerBwd) state.powerBwd.digitalWrite(0);
      }
    } else {
      console.log(`[MOCK] Lane ${laneId} Power -> ${isOn ? 'ON' : 'OFF'}`);
    }
  }

  setLaneSpeed(laneId, speedPercent) {
    // speedPercent 0-100
    const lane = this.lanes.find(l => l.id === laneId);
    if (!lane) return;

    // clamp between 0 and 100
    speedPercent = Math.max(0, Math.min(100, speedPercent));
    lane.speedLevel = speedPercent;

    if (pigpioEnabled && this.hardwareState.lanes[laneId]) {
      if (this.hardwareState.lanes[laneId].pwm) {
        // mapped to 0-255 for pwmWrite
        const dutyCycle = Math.floor((speedPercent / 100) * 255);
        this.hardwareState.lanes[laneId].pwm.pwmWrite(dutyCycle);
      }
    } else {
      console.log(`[MOCK] Lane ${laneId} PWM Speed -> ${speedPercent}%`);
    }
  }

  beep(durationMs = 200) {
    if (pigpioEnabled && this.hardwareState.buzzer) {
      // EMI blind spot for buzzer turning ON
      this.emiDebounceUntil = Date.now() + 150;
      this.hardwareState.buzzer.digitalWrite(1);
      
      setTimeout(() => {
        // EMI blind spot for buzzer turning OFF (major inductive spike)
        this.emiDebounceUntil = Date.now() + 150;
        this.hardwareState.buzzer.digitalWrite(0);
      }, durationMs);
    } else {
      console.log(`[MOCK] Buzzer -> BEEP (${durationMs}ms)`);
      this.emit('mockBeep', { durationMs });
    }
  }

  playSound(soundName) {
    this.emit('playSound', { sound: soundName });
  }

  // Debug/Mock helper
  mockLapTrigger(laneId) {
    if (!pigpioEnabled) {
      console.log(`[MOCK] Emitting fake lap trigger for lane ${laneId}`);
      this.emit('lapSensorTriggered', { laneId, tick: Date.now() * 1000 }); // mock tick in microseconds
    }
  }
}

module.exports = new Hardware();
