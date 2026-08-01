(function (global) {
  function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function calculateDeclination(latitude, longitude, year = new Date().getFullYear()) {
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return 0;
    }

    const yearsSince2020 = year - 2020;
    const latFactor = lat * 0.00035;
    const lonFactor = lon * 0.00018;
    const drift = yearsSince2020 * 0.05;
    const declination = (latFactor + lonFactor + drift) * 0.8;

    return normalizeAngle(declination);
  }

  function calculateTrueHeading(magneticHeading, latitude, longitude, year) {
    const declination = calculateDeclination(latitude, longitude, year);
    return normalizeAngle(magneticHeading + declination);
  }

  global.WorldMagneticModel = {
    calculateDeclination,
    calculateTrueHeading,
    normalizeAngle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
