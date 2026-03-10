const EventEmitter = require('events');

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
    this.lanes = [
      { id: 1, sensorPin: 17, powerPin: 27, pwmPin: 22, isPowerOn: false, speedLevel: 0 },
      { id: 2, sensorPin: 23, powerPin: 24, pwmPin: 25, isPowerOn: false, speedLevel: 0 }
    ];
    this.buzzerPin = 5;
    
    // Initialize actual hardware if available
    this.hardwareState = {};
    if (pigpioEnabled) {
      this.initHardware();
    }
  }

  initHardware() {
    // Buzzer initialization
    this.hardwareState.buzzer = new Gpio(this.buzzerPin, {mode: Gpio.OUTPUT});
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
        // debounce/jitter will be handled in race logic, just emit raw event here
        this.emit('lapSensorTriggered', { laneId: lane.id, tick });
      });

      // Power relay/switch
      const power = new Gpio(lane.powerPin, {mode: Gpio.OUTPUT});
      power.digitalWrite(0);

      // PWM for speed
      const pwm = new Gpio(lane.pwmPin, {mode: Gpio.OUTPUT});
      pwm.pwmWrite(0);

      this.hardwareState.lanes[lane.id] = { sensor, power, pwm };
    });
  }

  // --- API ---

  setLanePower(laneId, isOn) {
    const lane = this.lanes.find(l => l.id === laneId);
    if (!lane) return;
    lane.isPowerOn = isOn;

    if (pigpioEnabled && this.hardwareState.lanes[laneId]) {
      this.hardwareState.lanes[laneId].power.digitalWrite(isOn ? 1 : 0);
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
      // mapped to 0-255 for pwmWrite
      const dutyCycle = Math.floor((speedPercent / 100) * 255);
      this.hardwareState.lanes[laneId].pwm.pwmWrite(dutyCycle);
    } else {
      console.log(`[MOCK] Lane ${laneId} PWM Speed -> ${speedPercent}%`);
    }
  }

  beep(durationMs = 200) {
    if (pigpioEnabled && this.hardwareState.buzzer) {
      this.hardwareState.buzzer.digitalWrite(1);
      setTimeout(() => {
        this.hardwareState.buzzer.digitalWrite(0);
      }, durationMs);
    } else {
      console.log(`[MOCK] Buzzer -> BEEP (${durationMs}ms)`);
      this.emit('mockBeep', { durationMs });
    }
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
