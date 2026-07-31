const headingValue = document.getElementById('headingValue');
const cardinalValue = document.getElementById('cardinalValue');
const targetValue = document.getElementById('targetValue');
const errorValue = document.getElementById('errorValue');
const stateValue = document.getElementById('stateValue');
const enableButton = document.getElementById('enableButton');
const setTargetButton = document.getElementById('setTargetButton');
const muteButton = document.getElementById('muteButton');

let audioContext;
let oscillator;
let gainNode;
let currentHeading = null;
let targetBearing = null;
let isMuted = false;
let lastSpokenCardinal = null;

const cardinalPoints = [
  { name: 'N', angle: 0 },
  { name: 'NE', angle: 45 },
  { name: 'E', angle: 90 },
  { name: 'SE', angle: 135 },
  { name: 'S', angle: 180 },
  { name: 'SW', angle: 225 },
  { name: 'W', angle: 270 },
  { name: 'NW', angle: 315 },
];

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function computeAngularError(current, target) {
  const delta = normalizeAngle(current - target + 540) - 180;
  return delta;
}

function getDirectionLabel(angle) {
  const index = Math.round(normalizeAngle(angle) / 45) % 8;
  return cardinalPoints[index].name;
}

function getNearestCardinal(angle) {
  const normalized = normalizeAngle(angle);
  let best = null;

  for (const point of cardinalPoints) {
    const error = Math.abs(normalizeAngle(normalized - point.angle + 540) - 180);
    if (best === null || error < best.error) {
      best = { name: point.name, angle: point.angle, error };
    }
  }

  return best;
}

function speakCardinalDirection(name) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
  if (lastSpokenCardinal === name) return;

  lastSpokenCardinal = name;
  window.speechSynthesis.cancel();

  const spokenName = {
    N: 'North',
    E: 'East',
    S: 'South',
    W: 'West',
    NE: 'Northeast',
    SE: 'Southeast',
    SW: 'Southwest',
    NW: 'Northwest',
  }[name] || name;

  const utterance = new SpeechSynthesisUtterance(spokenName);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

function updateStatus() {
  headingValue.textContent = currentHeading === null ? '—' : `${currentHeading.toFixed(0)}°`;
  cardinalValue.textContent = currentHeading === null ? '—' : getDirectionLabel(currentHeading);
  targetValue.textContent = targetBearing === null ? '—' : `${targetBearing.toFixed(0)}°`;

  if (currentHeading === null) {
    errorValue.textContent = '—';
    stopTone();
    stateValue.textContent = 'Waiting for compass data...';
    return;
  }

  if (targetBearing === null) {
    errorValue.textContent = '—';

    const nearestCardinal = getNearestCardinal(currentHeading);
    const absCardinalError = Math.abs(nearestCardinal.error);
    const exactCardinal = absCardinalError <= 0.5;

    if (exactCardinal && !isMuted) {
      speakCardinalDirection(nearestCardinal.name);
    }

    if (absCardinalError <= 5 && !isMuted) {
      playTone(5 - absCardinalError + 1);
      stateValue.textContent = exactCardinal
        ? `On ${nearestCardinal.name}`
        : `Near ${nearestCardinal.name} – sound active`;
    } else {
      stopTone();
      stateValue.textContent = `Heading ${nearestCardinal.name}`;
    }

    return;
  }

  const error = computeAngularError(currentHeading, targetBearing);
  const absError = Math.abs(error);
  errorValue.textContent = `${error.toFixed(0)}° ${error === 0 ? '(on target)' : error > 0 ? 'right' : 'left'}`;

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
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
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
