const headingValue = document.getElementById('headingValue');
const targetValue = document.getElementById('targetValue');
const errorValue = document.getElementById('errorValue');
const stateValue = document.getElementById('stateValue');
const directionValue = document.getElementById('directionValue');
const enableButton = document.getElementById('enableButton');
const setTargetButton = document.getElementById('setTargetButton');
const muteButton = document.getElementById('muteButton');

let audioContext;
let oscillator;
let gainNode;
let currentHeading = null;
let targetBearing = null;
let isMuted = false;

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function computeAngularError(current, target) {
  const delta = normalizeAngle(current - target + 540) - 180;
  return delta;
}

function updateStatus() {
  headingValue.textContent = currentHeading === null ? '—' : `${currentHeading.toFixed(0)}°`;
  targetValue.textContent = targetBearing === null ? '—' : `${targetBearing.toFixed(0)}°`;

  if (currentHeading === null || targetBearing === null) {
    errorValue.textContent = '—';
    directionValue.textContent = '—';
    return;
  }

  const error = computeAngularError(currentHeading, targetBearing);
  const absError = Math.abs(error);
  const direction = error === 0 ? 'On target' : error > 0 ? 'Turn right' : 'Turn left';
  errorValue.textContent = `${error.toFixed(0)}°`;
  directionValue.textContent = direction;

  const shouldPlay = absError > 0 && absError < 5;

  if (shouldPlay && !isMuted) {
    playTone(absError);
    stateValue.textContent = 'Off-target – sound active';
  } else if (absError >= 5) {
    stopTone();
    stateValue.textContent = 'Off-target – no sound';
  } else {
    stopTone();
    stateValue.textContent = 'On target';
  }
}

function ensureAudioContext() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  gainNode = audioContext.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioContext.destination);
}

function playTone(errorMagnitude) {
  ensureAudioContext();
  if (!oscillator) {
    oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    oscillator.connect(gainNode);
    oscillator.start();
  }
  const frequency = 420 + Math.min(errorMagnitude, 80) * 4;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gainNode.gain.setTargetAtTime(0.12, audioContext.currentTime, 0.02);
}

function stopTone() {
  if (!oscillator || !gainNode) return;
  gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.015);
}

function handleOrientation(event) {
  let heading = null;

  if (typeof event.webkitCompassHeading === 'number') {
    heading = event.webkitCompassHeading;
  } else if (typeof event.alpha === 'number') {
    heading = 360 - event.alpha;
  }

  if (heading === null || Number.isNaN(heading)) {
    stateValue.textContent = 'Compass data unavailable';
    return;
  }

  currentHeading = normalizeAngle(heading);
  updateStatus();
  setTargetButton.disabled = false;
  muteButton.disabled = false;
}

async function enableCompass() {
  if (!window.isSecureContext || window.location.protocol === 'file:') {
    stateValue.textContent = 'Open this app from a local server or HTTPS for compass access.';
    return;
  }

  if (typeof DeviceOrientationEvent === 'undefined') {
    stateValue.textContent = 'This browser does not support device orientation.';
    return;
  }

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response !== 'granted') {
        stateValue.textContent = 'Permission denied';
        return;
      }
    } catch (error) {
      stateValue.textContent = 'Sensor permission failed';
      return;
    }
  }

  window.addEventListener('deviceorientation', handleOrientation, true);
  stateValue.textContent = 'Waiting for compass data...';
  enableButton.disabled = true;
}

enableButton.addEventListener('click', enableCompass);

setTargetButton.addEventListener('click', () => {
  if (currentHeading === null) return;
  targetBearing = currentHeading;
  updateStatus();
});

muteButton.addEventListener('click', () => {
  isMuted = !isMuted;
  muteButton.textContent = isMuted ? 'Unmute sound' : 'Mute sound';
  updateStatus();
});
