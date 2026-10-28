// Delivery-date estimation rules.
// Dates are handled as UTC midnight so the viewer's timezone can't shift a day.

// Air services: fixed business days, regardless of distance.
const AIR_SERVICES = {
  "next day air": { label: "UPS Next Day Air", days: [1, 1] },
  "next day air saver": { label: "UPS Next Day Air Saver", days: [1, 1] },
  "2nd day air": { label: "UPS 2nd Day Air", days: [2, 2] },
  "3 day select": { label: "UPS 3 Day Select", days: [3, 3] },
};

// UPS Ground: zone by straight-line miles. Each band includes its upper limit.
// The promised date uses the slower end of the range.
const GROUND_ZONES = [
  { zone: 2, maxMiles: 150, days: [1, 2] },
  { zone: 3, maxMiles: 300, days: [1, 2] },
  { zone: 4, maxMiles: 600, days: [2, 3] },
  { zone: 5, maxMiles: 1000, days: [3, 4] },
  { zone: 6, maxMiles: 1400, days: [4, 5] },
  { zone: 7, maxMiles: 1800, days: [5, 6] },
  { zone: 8, maxMiles: Infinity, days: [5, 7] },
];

// The merchant promises delivery within 5–7 business days of the order, for every
// service level (processing doesn't prioritize faster services). The promise is
// the slow end of that cushion.
const PROMISE_BUSINESS_DAYS = 7;

// ZIP prefixes (first three digits) for the states with special Ground rules.
const ALASKA_PREFIXES = ["995", "996", "997", "998", "999"];
const HAWAII_PREFIXES = ["967", "968"];

function normalizeServiceLevel(raw) {
  return raw
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/^ups\s+/, "")
    .replace(/\bsecond\b/, "2nd")
    .replace(/\s+/g, " ")
    .trim();
}

function regionOf(zip) {
  const prefix = zip.slice(0, 3);
  if (ALASKA_PREFIXES.includes(prefix)) return "AK";
  if (HAWAII_PREFIXES.includes(prefix)) return "HI";
  return "mainland";
}

// --- ZIP locations ---

let zip3Centers = null;

// Average location of every ZIP sharing the same first three digits, used when
// a ZIP isn't in the Census list (e.g. some PO-box-only ZIPs).
function buildZip3Centers() {
  const sums = {};
  for (const [zip, [lat, lon]] of Object.entries(window.ZIP_COORDS)) {
    const p = zip.slice(0, 3);
    const s = sums[p] || (sums[p] = { lat: 0, lon: 0, n: 0 });
    s.lat += lat;
    s.lon += lon;
    s.n++;
  }
  const centers = {};
  for (const [p, s] of Object.entries(sums)) centers[p] = [s.lat / s.n, s.lon / s.n];
  return centers;
}

// Returns { coords: [lat, lon], approximate: boolean } or null if unknown.
function locateZip(zip) {
  const exact = window.ZIP_COORDS[zip];
  if (exact) return { coords: exact, approximate: false };
  if (!zip3Centers) zip3Centers = buildZip3Centers();
  const near = zip3Centers[zip.slice(0, 3)];
  return near ? { coords: near, approximate: true } : null;
}

function milesBetween([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8; // Earth's radius in miles
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function groundZoneFor(miles) {
  return GROUND_ZONES.find((z) => miles <= z.maxMiles);
}

// --- Dates ---

// Accepts 2026-10-19 or 10/19/2026 (how Excel often re-saves dates).
// Returns a UTC Date, or null if the text isn't a real calendar date.
function parseDate(text) {
  const s = text.trim();
  let y, m, d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [y, m, d] = [+match[1], +match[2], +match[3]];
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [m, d, y] = [+match[1], +match[2], +match[3]];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? date : null;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

// nth weekday of a month (weekday 0 = Sunday); n = -1 means the last one.
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month + 1, -offset));
}

// A fixed-date holiday on a Saturday is observed Friday; on a Sunday, Monday.
function observed(date) {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

const holidayCache = {};

// Major UPS holidays (no pickup or delivery), as YYYY-MM-DD strings.
function upsHolidays(year) {
  if (!holidayCache[year]) {
    holidayCache[year] = new Set(
      [
        observed(new Date(Date.UTC(year, 0, 1))), // New Year's Day
        nthWeekday(year, 4, 1, -1), // Memorial Day: last Monday in May
        observed(new Date(Date.UTC(year, 6, 4))), // Independence Day
        nthWeekday(year, 8, 1, 1), // Labor Day: first Monday in September
        nthWeekday(year, 10, 4, 4), // Thanksgiving: fourth Thursday in November
        observed(new Date(Date.UTC(year, 11, 25))), // Christmas Day
      ].map(isoDate)
    );
  }
  return holidayCache[year];
}

function isBusinessDay(date) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  // Next year's New Year's Day can be observed on Dec 31.
  const y = date.getUTCFullYear();
  const iso = isoDate(date);
  return !upsHolidays(y).has(iso) && !upsHolidays(y + 1).has(iso);
}

// Transit starts the business day after pickup. A package handed over on a
// weekend or holiday is picked up the next business day.
function deliveryDate(shipDate, transitDays) {
  let date = nextBusinessDay(shipDate);
  for (let left = transitDays; left > 0; ) {
    date = addDays(date, 1);
    if (isBusinessDay(date)) left--;
  }
  return date;
}

// Business days after `from`, up to and including `to` (0 if `to` isn't later).
function businessDaysBetween(from, to) {
  let count = 0;
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    if (isBusinessDay(date)) count++;
  }
  return count;
}

// UPS delivers Saturdays, but not Sundays or UPS holidays. Used for weather delays;
// the transit estimates themselves still count business days (Mon–Fri).
function isDeliveryDay(date) {
  if (date.getUTCDay() === 0) return false;
  const y = date.getUTCFullYear();
  const iso = isoDate(date);
  return !upsHolidays(y).has(iso) && !upsHolidays(y + 1).has(iso);
}

function nextDeliveryDay(date) {
  let next = addDays(date, 1);
  while (!isDeliveryDay(next)) next = addDays(next, 1);
  return next;
}

function nextBusinessDay(date) {
  while (!isBusinessDay(date)) date = addDays(date, 1);
  return date;
}

// The date promised at checkout. A weekend or holiday order counts from the
// next business day.
function promisedDate(orderDate) {
  return deliveryDate(orderDate, PROMISE_BUSINESS_DAYS);
}

// Business days the merchant took to ship. 0 means shipped on the first
// business day the order was in (e.g. ordered Saturday, shipped Monday).
function processingDays(orderDate, shipDate) {
  return businessDaysBetween(nextBusinessDay(orderDate), shipDate);
}

// --- Estimate for one order ---

// Returns { error } or { serviceLabel, miles, zone, minDays, maxDays,
// earliest, promised, approximateLocation }.
function estimateDelivery({ originZip, destinationZip, serviceLevel, shipDate }) {
  const service = normalizeServiceLevel(serviceLevel);
  const origin = locateZip(originZip);
  const destination = locateZip(destinationZip);
  if (!origin) return { error: `Origin ZIP ${originZip} wasn't found.` };
  if (!destination) return { error: `Destination ZIP ${destinationZip} wasn't found.` };

  const miles = milesBetween(origin.coords, destination.coords);
  const approximateLocation = origin.approximate || destination.approximate;
  let days, zone, serviceLabel;

  if (service === "ground") {
    const from = regionOf(originZip);
    const to = regionOf(destinationZip);
    if (from === "HI" || to === "HI") {
      return { error: "UPS Ground isn't available to or from Hawaii. Use an air service." };
    }
    if ((from === "AK") !== (to === "AK")) {
      return { error: "UPS Ground doesn't run between Alaska and the mainland. Use an air service." };
    }
    const band = groundZoneFor(miles);
    days = band.days;
    zone = band.zone;
    serviceLabel = "UPS Ground";
  } else if (AIR_SERVICES[service]) {
    days = AIR_SERVICES[service].days;
    zone = null;
    serviceLabel = AIR_SERVICES[service].label;
  } else {
    return { error: `Unknown UPS service level "${serviceLevel}".` };
  }

  return {
    serviceLabel,
    miles,
    zone,
    minDays: days[0],
    maxDays: days[1],
    earliest: deliveryDate(shipDate, days[0]),
    promised: deliveryDate(shipDate, days[1]),
    approximateLocation,
    originCoords: origin.coords,
    destinationCoords: destination.coords,
  };
}
