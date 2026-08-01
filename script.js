const locationValue = document.getElementById('locationValue');
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
const destinationInput = document.getElementById('destinationInput');
const getDirectionsButton = document.getElementById('getDirectionsButton');
const cancelRouteButton = document.getElementById('cancelRouteButton');
const nextStepValue = document.getElementById('nextStepValue');
const distanceValue = document.getElementById('distanceValue');
const mapContainer = document.getElementById('map');

import { field as geomagneticField } from 'https://cdn.jsdelivr.net/npm/geomag@1.0.0/dist/geomag.m.js';
import { GOOGLE_MAPS_API_KEY } from './config.js';

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

let mapsReady = false;
let RouteClass = null;
let MapClass = null;
let MarkerClass = null;
let routeSteps = null;
let currentStepIndex = 0;
let watchId = null;
const ARRIVAL_RADIUS_METERS = 20;

let map = null;
let originMarker = null;
let destinationMarker = null;
let routePolyline = null;

const cardinalPoints = [
  { name: 'N', angle: 0 },
  { name: 'E', angle: 90 },
  { name: 'S', angle: 180 },
  { name: 'W', angle: 270 },
];

function updateLocationDisplay(latitude, longitude, accuracy) {
  const accuracyText = typeof accuracy === 'number' ? ` (±${accuracy.toFixed(0)} m)` : '';
  locationValue.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracyText}`;
}

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

        updateLocationDisplay(position.coords.latitude, position.coords.longitude, position.coords.accuracy);

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
  const heading = normalizeAngle(360 - event.alpha + screenAngle);  // Add back the 360 -

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
    maybeEnableDirectionsButton();
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

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

function maybeEnableDirectionsButton() {
  getDirectionsButton.disabled = !(mapsReady && currentLocation);
}

function ensureMap(center) {
  if (map) return;
  map = new MapClass(mapContainer, {
    center,
    zoom: 17,
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
  });
  originMarker = new MarkerClass({
    map,
    position: center,
    title: 'You',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#4285F4',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    },
  });
}

function drawRoute(steps, origin) {
  const path = [];
  steps.forEach(step => {
    if (Array.isArray(step.path) && step.path.length) {
      step.path.forEach(point => path.push({ lat: point.lat, lng: point.lng }));
    } else {
      path.push(step.startLocation, step.endLocation);
    }
  });

  if (routePolyline) routePolyline.setMap(null);
  routePolyline = new google.maps.Polyline({
    path,
    map,
    strokeColor: '#2f85f3',
    strokeWeight: 5,
    strokeOpacity: 0.9,
  });

  const destination = steps[steps.length - 1].endLocation;
  if (destinationMarker) destinationMarker.setMap(null);
  destinationMarker = new MarkerClass({ map, position: destination, title: 'Destination' });

  const bounds = new google.maps.LatLngBounds();
  path.forEach(point => bounds.extend(point));
  bounds.extend(origin);
  map.fitBounds(bounds, 40);
}

function updateOriginMarker(position) {
  if (originMarker) originMarker.setPosition(position);
}

function clearRouteFromMap() {
  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
  if (destinationMarker) {
    destinationMarker.setMap(null);
    destinationMarker = null;
  }
}

function primaryInstruction(instructions) {
  return instructions.split('\n')[0];
}

function setNavUi({ nextStep, distance } = {}) {
  nextStepValue.textContent = nextStep ?? '—';
  distanceValue.textContent = distance ?? '—';
}

function stopNavigation() {
  routeSteps = null;
  currentStepIndex = 0;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  targetBearing = null;
  cancelRouteButton.disabled = true;
  getDirectionsButton.disabled = !(mapsReady && currentLocation);
  destinationInput.disabled = false;
  clearRouteFromMap();
  setNavUi();
  updateStatus();
}

function advanceToStep(index) {
  currentStepIndex = index;

  if (!routeSteps || currentStepIndex >= routeSteps.length) {
    speak('You have arrived at your destination');
    setNavUi({ nextStep: 'Arrived', distance: '0 m' });
    stopNavigation();
    return;
  }

  const instruction = primaryInstruction(routeSteps[currentStepIndex].instructions);
  nextStepValue.textContent = instruction;
  speak(instruction);
}

function updateNavigation() {
  if (!routeSteps || !currentLocation) return;

  const step = routeSteps[currentStepIndex];
  if (!step) return;

  const here = new google.maps.LatLng(currentLocation.latitude, currentLocation.longitude);
  const stepEnd = new google.maps.LatLng(step.endLocation.lat, step.endLocation.lng);

  updateOriginMarker({ lat: currentLocation.latitude, lng: currentLocation.longitude });

  const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(here, stepEnd);
  distanceValue.textContent = `${distanceMeters.toFixed(0)} m`;

  if (distanceMeters <= ARRIVAL_RADIUS_METERS) {
    advanceToStep(currentStepIndex + 1);
    return;
  }

  const bearing = google.maps.geometry.spherical.computeHeading(here, stepEnd);
  targetBearing = normalizeAngle(bearing);
  updateStatus();
}

async function requestDirections() {
  const destination = destinationInput.value.trim();
  if (!destination || !currentLocation || !RouteClass) return;

  getDirectionsButton.disabled = true;
  nextStepValue.textContent = 'Finding route…';

  let response;
  try {
    response = await RouteClass.computeRoutes({
      origin: { lat: currentLocation.latitude, lng: currentLocation.longitude },
      destination,
      travelMode: google.maps.TravelMode.WALKING,
      fields: ['legs'],
    });
  } catch (error) {
    console.warn('Directions request failed:', error);
    response = null;
  }

  if (!response || !response.routes.length) {
    nextStepValue.textContent = 'No route found';
    speak('No route found for that address');
    getDirectionsButton.disabled = !(mapsReady && currentLocation);
    return;
  }

  routeSteps = response.routes[0].legs[0].steps;
  destinationInput.disabled = true;
  cancelRouteButton.disabled = false;

  const origin = { lat: currentLocation.latitude, lng: currentLocation.longitude };
  ensureMap(origin);
  drawRoute(routeSteps, origin);

  advanceToStep(0);

  watchId = navigator.geolocation.watchPosition(
    position => {
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      updateLocationDisplay(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
      updateNavigation();
    },
    error => console.warn('Navigation position error:', error),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

getDirectionsButton.addEventListener('click', requestDirections);

cancelRouteButton.addEventListener('click', () => {
  speak('Navigation cancelled');
  stopNavigation();
});

loadGoogleMaps()
  .then(async () => {
    const [routesLib, mapsLib, markerLib] = await Promise.all([
      google.maps.importLibrary('routes'),
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('marker'),
    ]);
    RouteClass = routesLib.Route;
    MapClass = mapsLib.Map;
    MarkerClass = markerLib.Marker;
    mapsReady = true;
    maybeEnableDirectionsButton();
  })
  .catch(error => console.warn(error));
