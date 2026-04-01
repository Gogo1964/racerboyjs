class RacerApp {
  constructor() {
    this.state = null;
    this.ws = null;
    this.reconnectTimer = null;
    this.onStateUpdateCbs = [];
  }

  init() {
    this.connectWS();
  }

  connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WS Connected');
      if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    };

    this.ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      if (type === 'fullState' || type === 'stateUpdate') {
        this.state = payload;
        this.triggerStateUpdate();
      } else if (type === 'lapRecorded') {
        this.playSound(`blipLane${payload.laneId}Passed.wav`);
        this.handleLapRecorded(payload);
      } else if (type === 'penalty') {
        this.handlePenalty(payload);
      } else if (type === 'beep') {
        this.handleBeep(payload.durationMs);
      } else if (type === 'playSound') {
        this.playSound(`${payload.sound}.wav`);
      }
    };

    this.ws.onclose = () => {
      console.log('WS Disconnected, reconnecting...');
      this.reconnectTimer = setTimeout(() => this.connectWS(), 2000);
    };
  }

  onStateUpdate(cb) {
    this.onStateUpdateCbs.push(cb);
  }

  triggerStateUpdate() {
    this.onStateUpdateCbs.forEach(cb => cb(this.state));
  }

  handleLapRecorded(payload) {
    // Pulse animation dispatcher
    const el = document.getElementById(`lane-${payload.laneId}-last-lap`);
    if (el) {
      el.classList.remove('animate-pulse');
      void el.offsetWidth; // trigger reflow
      el.classList.add('animate-pulse');
    }
  }

  handlePenalty(payload) {
    console.log(`Penalty on lane ${payload.laneId}`);
    // Visual indicator handles itself via state
  }

  handleBeep(durationMs) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return; // not supported
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, ctx.currentTime); // 440Hz beep
      
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime); // volume
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (durationMs / 1000));
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + (durationMs / 1000));
    } catch (e) {
      console.log('Web audio beep failed', e);
    }
  }

  playSound(filename) {
    const audio = new Audio(`/${filename}`);
    audio.play().catch(e => console.log('Audio play failed:', e));
  }

  formatMs(ms) {
    if (!ms || ms === Infinity) return '0.000';
    return (ms / 1000).toFixed(3);
  }

  formatTimeRemaining(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  apiCommand(action, payload = {}) {
    return fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload })
    });
  }
}

window.app = new RacerApp();
window.app.init();

// Global Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.ctrlKey && e.shiftKey) {
        if (e.code === 'Digit1') {
            e.preventDefault();
            window.app.apiCommand('toggleLanePower', { laneId: 1 });
            return;
        }
        if (e.code === 'Digit2') {
            e.preventDefault();
            window.app.apiCommand('toggleLanePower', { laneId: 2 });
            return;
        }
    }

    if (e.ctrlKey && !e.shiftKey) {
        if (e.code === 'Digit1') {
            e.preventDefault();
            window.app.apiCommand('adjustLap', { laneId: 1, delta: -1 });
            return;
        }
        if (e.code === 'Digit2') {
            e.preventDefault();
            window.app.apiCommand('adjustLap', { laneId: 2, delta: -1 });
            return;
        }
    }

    if (e.shiftKey && !e.ctrlKey) {
        if (e.code === 'Digit1') {
            e.preventDefault();
            window.app.apiCommand('adjustLap', { laneId: 1, delta: 1 });
            return;
        }
        if (e.code === 'Digit2') {
            e.preventDefault();
            window.app.apiCommand('adjustLap', { laneId: 2, delta: 1 });
            return;
        }
    }

    switch(e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            window.app.apiCommand('startRace');
            break;
        case 'escape':
            window.app.apiCommand('stopRace');
            break;
        case 'r':
            window.app.apiCommand('resetLaps');
            break;
        case 't':
            window.location.href = '/training.html';
            break;
        case 'm':
            window.location.href = '/race.html';
            break;
        case 'p':
            if (e.shiftKey) {
                window.app.apiCommand('setGlobalPower', { power: true });
            } else {
                window.app.apiCommand('setGlobalPower', { power: false });
            }
            break;
        case '1':
            window.app.apiCommand('mockLap', { laneId: 1 });
            break;
        case '2':
            window.app.apiCommand('mockLap', { laneId: 2 });
            break;
    }
});
