// Weather that could delay a package on a given day, from the National Weather
// Service (api.weather.gov): free, no key, and allows browser requests from any page.

const NWS_API = "https://api.weather.gov";
const SEVERE_LEVELS = ["Extreme", "Severe"]; // NWS severity; Moderate and Minor are ignored
// Emergency alerts count whatever their severity rating.
const EMERGENCY_EVENTS = [
  "Civil Emergency Message",
  "Local Area Emergency",
  "Civil Danger Warning",
  "Evacuation Immediate",
  "Shelter In Place Warning",
  "Nuclear Power Plant Warning",
  "Hazardous Materials Warning",
];
const SNOW_LIMIT_INCHES = 8; // more than this in one day is likely to delay delivery
const WEATHER_TIMEOUT_MS = 10000;
const WEATHER_CONCURRENCY = 4;

// ZIP -> Promise of a location's weather (see lookUpLocation) or { error: "..." }.
// Each ZIP is looked up once per page session; failures are dropped from the
// cache so a retry can try them again.
const weatherCache = new Map();

function checkWeather(zip, coords) {
  if (!weatherCache.has(zip)) {
    const lookup = lookUpLocation(coords).catch((err) => {
      weatherCache.delete(zip);
      return { error: describeWeatherError(err) };
    });
    weatherCache.set(zip, lookup);
  }
  return weatherCache.get(zip);
}

// Looks up several ZIPs, a few at a time, calling onResult(zip, result) as each finishes.
async function checkWeatherForZips(zipCoords, onResult) {
  const queue = [...zipCoords];
  const worker = async () => {
    while (queue.length) {
      const [zip, coords] = queue.shift();
      onResult(zip, await checkWeather(zip, coords));
    }
  };
  await Promise.all(Array.from({ length: Math.min(WEATHER_CONCURRENCY, queue.length) }, worker));
}

// --- Fetching ---

// Three requests per location: active alerts (including ones that start later),
// the point's forecast grid and time zone, then that grid's snowfall forecast.
async function lookUpLocation([lat, lon]) {
  const point = `${lat.toFixed(4)},${lon.toFixed(4)}`; // the API takes at most 4 decimals
  const [alertData, pointData] = await Promise.all([
    getJSON(`${NWS_API}/alerts/active?point=${point}`),
    getJSON(`${NWS_API}/points/${point}`),
  ]);
  const { timeZone, forecastGridData } = pointData.properties || {};
  if (!timeZone || !forecastGridData) throw new Error("no forecast for this location");
  const grid = await getJSON(forecastGridData);

  return {
    timeZone,
    alerts: delayAlertsFrom(alertData.features || []),
    ...snowByDay((grid.properties.snowfallAmount || {}).values || [], timeZone),
  };
}

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/geo+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function describeWeatherError(err) {
  if (err && err.name === "AbortError") return "timed out";
  if (err instanceof TypeError) return "no connection";
  return (err && err.message) || "unknown error";
}

// --- Turning API data into "what happens on which day" ---

function delayAlertsFrom(features) {
  return features
    .map((f) => f.properties)
    .filter((p) => p && (SEVERE_LEVELS.includes(p.severity) || EMERGENCY_EVENTS.includes(p.event)))
    .map((p) => ({
      event: p.event,
      headline: p.headline || p.event,
      start: new Date(p.onset || p.effective || p.sent),
      end: p.ends || p.expires ? new Date(p.ends || p.expires) : null, // null = until further notice
    }));
}

// Forecast snow comes in blocks ("2026-10-28T06:00:00+00:00/PT6H", in mm).
// Each block is spread evenly over its hours and added up per local calendar day.
function snowByDay(values, timeZone) {
  const mmByDay = {};
  let lastHour = null;
  for (const { validTime, value } of values) {
    const [startText, duration] = validTime.split("/");
    const start = new Date(startText);
    const hours = Math.max(1, durationHours(duration));
    for (let h = 0; h < hours; h++) {
      const hour = new Date(start.getTime() + h * 3600000);
      const day = localDay(hour, timeZone);
      mmByDay[day] = (mmByDay[day] || 0) + (value || 0) / hours;
      lastHour = hour;
    }
  }
  const snowInches = {};
  for (const [day, mm] of Object.entries(mmByDay)) snowInches[day] = mm / 25.4;
  return { snowInches, forecastUntil: lastHour ? localDay(lastHour, timeZone) : null };
}

// "PT6H", "P1DT12H" -> hours
function durationHours(text) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text) || [];
  return (+m[1] || 0) * 24 + (+m[2] || 0) + Math.round((+m[3] || 0) / 60);
}

// The calendar date (YYYY-MM-DD) of an instant in a given time zone.
function localDay(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// What could delay a package at this location on this day (YYYY-MM-DD):
// returns { reasons: [...] } or { noForecast: true } when the day is past the snow forecast.
function weatherOnDay(location, day) {
  const reasons = location.alerts
    .filter((a) => localDay(a.start, location.timeZone) <= day &&
      (!a.end || localDay(new Date(a.end.getTime() - 60000), location.timeZone) >= day))
    .map((a) => ({ text: a.event, detail: a.headline }));

  // Rounded to 0.1 in. so splitting blocks into hours can't turn exactly 8 into "over 8".
  const inches = Math.round((location.snowInches[day] || 0) * 10) / 10;
  if (inches > SNOW_LIMIT_INCHES) {
    reasons.push({
      text: `${Math.round(inches)} in. snow`,
      detail: `About ${inches.toFixed(1)} inches of snow forecast that day.`,
    });
  }
  const noForecast = !location.forecastUntil || day > location.forecastUntil;
  return { reasons, noForecast };
}
