const headingValue = document.getElementById('headingValue');
const cardinalValue = document.getElementById('cardinalValue');
const targetValue = document.getElementById('targetValue');
const orientationValue = document.getElementById('orientationValue');
const errorValue = document.getElementById('errorValue');
const stateValue = document.getElementById('stateValue');
const directionValue = document.getElementById('directionValue');
const enableButton = document.getElementById('enableButton');
const setTargetButton = document.getElementById('setTargetButton');
const muteButton = document.getElementById('muteButton');

import { field as geomagneticField } from 'https://cdn.jsdelivr.net/npm/geomag@1.0.0/dist/geomag.m.js';

let audioContext;
let oscillator;
let gainNode;
let currentHeading = null;
let targetBearing = null;
let isMuted = false;
let lastVibrationState = null;
let orientationOk = null;
let lastOrientationState = null;
let lastSpokenMessage = '';
let currentLocation = null;
let declinationOffset = 0; 
let declinationStatusMessage = '';

const cardinalPoints = [
  { name: 'N', angle: 0 },
  { name: 'E', angle: 90 },
  { name: 'S', angle: 180 },
  { name: 'W', angle: 270 },
];

async function getLocation() {
  if (!navigator.geolocation) {
    throw new Error('Geolocation is not supported by this browser.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      async position => {
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        declinationOffset = getDeclination(
          currentLocation.latitude,
          currentLocation.longitude
        );

        declinationStatusMessage = Math.abs(declinationOffset) > 0.0001
          ? `Location: ${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}. Using true north (${declinationOffset.toFixed(1)}° declination).`
          : `Location: ${currentLocation.latitude.toFixed(5)}, ${currentLocation.longitude.toFixed(5)}. Using the default heading.`;

        resolve(currentLocation);
      },
      error => {
        declinationStatusMessage = 'Location unavailable; using magnetic north.';
        reject(error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 20000,
      }
    );
  });
}


function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function getDeclination(lat, lon) {
  return geomagneticField(lat, lon).declination;
}

function getTrueHeading(magneticHeading, declination) {
  return normalizeAngle(magneticHeading - declination);
}

function computeAngularError(current, target) {
  const delta = normalizeAngle(current - target + 540) - 180;
  return delta;
}

function speak(message) {
  if (!('speechSynthesis' in window) || !message || isMuted) return;
  if (message === lastSpokenMessage) return;
  lastSpokenMessage = message;
  const utterance = new SpeechSynthesisUtterance(message);
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function getOrientationStatus(event) {
  if (typeof event.beta !== 'number' || typeof event.gamma !== 'number') {
    return null;
  }

  return Math.abs(event.beta) <= 25 && Math.abs(event.gamma) <= 25;
}

function getScreenOrientationAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }

  if (typeof window.orientation === 'number') {
    return window.orientation;
  }

  return 0;
}

function getDeviceHeading(event) {
  if (typeof event.webkitCompassHeading === 'number') {
    return { heading: normalizeAngle(event.webkitCompassHeading), isTrueNorth: false };
  }

  if (typeof event.alpha !== 'number') {
    return null;
  }

  const screenAngle = getScreenOrientationAngle();
  const heading = normalizeAngle(360 - event.alpha + screenAngle);

  return { heading, isTrueNorth: false };
}

function getDirectionLabel(angle) {
  const index = Math.floor((normalizeAngle(angle) + 45) / 90) % 4;
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

  window.speechSynthesis.cancel();

  const spokenName = {
    N: 'North',
    E: 'East',
    S: 'South',
    W: 'West',
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
    directionValue.textContent = '—';

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
  const direction = error === 0 ? 'On target' : error > 0 ? 'Turn left' : 'Turn right';
  errorValue.textContent = `${error.toFixed(0)}°`;
  directionValue.textContent = direction;

  if (orientationOk === false) {
    stopTone();
    triggerVibration(0, false);
    stateValue.textContent = 'Please hold the phone flat.';
    speak('Please hold the phone flat');
    return;
  }

  const shouldPlay = absError > 0 && absError < 5;

  if (shouldPlay && !isMuted) {
    playTone(absError);
    triggerVibration(absError);
    stateValue.textContent = 'Off-target – sound and vibration active';
    speak(direction);
  } else if (absError >= 5) {
    stopTone();
    triggerVibration(0, true);
    stateValue.textContent = 'Off-target – no sound';
  } else {
    stopTone();
    triggerVibration(0, false);
    stateValue.textContent = 'On target';
    speak('On target');
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

function triggerVibration(errorMagnitude, isOutOfRange = false) {
  if (!('vibrate' in navigator)) return;

  if (isOutOfRange) {
    if (lastVibrationState !== 'out-of-range') {
      navigator.vibrate(0);
      lastVibrationState = 'out-of-range';
    }
    return;
  }

  if (errorMagnitude <= 0) {
    if (lastVibrationState !== 'on-target') {
      navigator.vibrate(20);
      lastVibrationState = 'on-target';
    }
    return;
  }

  const duration = Math.min(120, 30 + errorMagnitude * 4);
  if (lastVibrationState !== 'off-target') {
    navigator.vibrate(duration);
    lastVibrationState = 'off-target';
  }
}

function handleOrientation(event) {
  const headingResult = getDeviceHeading(event);
  orientationOk = getOrientationStatus(event);
  if (orientationOk !== lastOrientationState) {
    lastOrientationState = orientationOk;
    if (orientationOk === false) {
      speak('Please hold the phone flat');
    } else if (orientationOk === true) {
      speak('Phone is flat enough');
    }
  }

  if (!headingResult || Number.isNaN(headingResult.heading)) {
    stateValue.textContent = 'Compass data unavailable';
    return;
  }

  currentHeading = headingResult.heading;
  if (!headingResult.isTrueNorth) {
    currentHeading = getTrueHeading(currentHeading, declinationOffset);
  }

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

  try {
    await getLocation();
  } catch (error) {
    console.warn('Unable to access location:', error);
  }

  window.addEventListener('deviceorientation', handleOrientation, true);
  stateValue.textContent = declinationStatusMessage || 'Waiting for compass data...';
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
