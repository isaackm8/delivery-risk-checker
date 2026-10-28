const REQUIRED_COLUMNS = [
  "order_id",
  "order_date",
  "order_value",
  "product_name",
  "product_description",
  "origin_zip",
  "destination_zip",
  "ups_service_level",
  "ship_date",
];
// Optional; needed to notify customers about delays.
const OPTIONAL_COLUMNS = ["customer_name", "customer_email", "tracking_number"];

// loadId increases with every file, so weather results for an older file are ignored.
// weather maps ZIP -> that location's weather (or { error }) once it arrives.
// selected holds the order IDs ticked for a delay notice.
const state = {
  orders: [],
  filter: "all",
  sort: { key: "ship", dir: 1 },
  loadId: 0,
  weather: new Map(),
  selected: new Set(),
  // Demo storms (weather.js): on for the sample file, with ?demo=weather, or when switched on.
  demoWeather: false,
};
const DEMO_FROM_ADDRESS = new URLSearchParams(location.search).get("demo") === "weather";

// "Today" decides which orders are delivered, in transit or not shipped yet.
// It's the computer's date; add ?today=YYYY-MM-DD to the page address to pretend otherwise.
const TODAY = (() => {
  const override = parseDate(new URLSearchParams(location.search).get("today") || "");
  if (override) return override;
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
})();

const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const messages = document.getElementById("messages");
const results = document.getElementById("results");

// --- Small DOM helpers (textContent only, so file contents are never run as HTML) ---

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

function showMessage(kind, title, items = []) {
  const box = el("div", { class: `message ${kind}`, role: kind === "error" ? "alert" : "status" }, [
    el("strong", { text: title }),
  ]);
  if (items.length) box.append(el("ul", {}, items.map((t) => el("li", { text: t }))));
  messages.append(box);
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fmtDate = (d) => dateFormat.format(d);

// Compact range: "Oct 20–21", or "Oct 30 – Nov 2" across months.
const shortFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function fmtRange(start, end) {
  if (isoDate(start) === isoDate(end)) return shortFormat.format(end);
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${shortFormat.format(start)}–${end.getUTCDate()}`;
  }
  return `${shortFormat.format(start)} – ${shortFormat.format(end)}`;
}
const fmtMoney = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// --- Reading the file ---

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// Excel drops leading zeros (02139 -> 2139) and some systems export ZIP+4.
function cleanZip(raw) {
  const s = raw.trim();
  if (/^\d{5}-\d{4}$/.test(s)) return s.slice(0, 5);
  if (/^\d{3,5}$/.test(s)) return s.padStart(5, "0");
  return null;
}

function parseMoney(raw) {
  const s = raw.trim().replace(/[$,]/g, "");
  return s !== "" && Number.isFinite(+s) ? +s : null;
}

function handleFile(file) {
  messages.replaceChildren();
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    showMessage("error", `"${file.name}" isn't a CSV file. Please choose a .csv file.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => loadOrders(String(reader.result), file.name);
  reader.onerror = () => showMessage("error", "The file couldn't be read. Please try again.");
  reader.readAsText(file);
}

function loadOrders(text, fileName) {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    results.hidden = true;
    showMessage("error", `"${fileName}" has no orders in it.`, [
      "Add one row per order below the header row. The field guide (link above) explains each column.",
    ]);
    return;
  }

  const headers = rows[0].map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    results.hidden = true;
    showMessage("error", `"${fileName}" is missing ${missing.length === 1 ? "a column" : "columns"}:`, [
      missing.join(", "),
      `Expected columns: ${REQUIRED_COLUMNS.join(", ")}. Optional: ${OPTIONAL_COLUMNS.join(", ")}.`,
      "Download the template or read the field guide (links above) for what each column needs.",
    ]);
    return;
  }

  // The sample file's dates are moved to be current today, and demo storms switched on,
  // so it always shows the same picture. Real files are never changed.
  const sample = isSampleFile(headers, rows.slice(1));
  if (sample) moveSampleDates(headers, rows.slice(1));
  state.demoWeather = sample || DEMO_FROM_ADDRESS;

  const orders = [];
  const problems = [];

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // line 1 is the header
    const get = (col) => (cells[headers.indexOf(col)] ?? "").trim();
    const order = parseOrder(get);
    const label = order.id ? `Line ${line} (${order.id})` : `Line ${line}`;
    if (order.error) problems.push(`${label}: ${order.error}`);
    else orders.push(order);
  });

  state.orders = orders;
  state.filter = "all";
  state.selected.clear();
  state.loadId++;

  if (sample) {
    showMessage("info", "This is the sample file, with made-up orders.", [
      `Its dates have been moved so they're current as of today (${fmtDate(TODAY)}): some orders not shipped yet, some in transit, some delivered.`,
      "Demo storms are switched on, so you can see weather delays. Weather marked (demo) is made up.",
      "Your own files are never changed like this.",
    ]);
  }

  if (problems.length) {
    showMessage(
      "warn",
      `${problems.length} of ${rows.length - 1} rows were skipped because of a problem:`,
      problems
    );
  }

  if (!orders.length) {
    results.hidden = true;
    return;
  }
  render();
  results.hidden = false;
  checkWeatherFor(orders);
}

// --- The sample file ---

// The sample is recognized by its made-up data: every customer email is on
// example.com (a domain reserved for examples) and every tracking number starts 1ZTEST.
function isSampleFile(headers, dataRows) {
  const email = headers.indexOf("customer_email");
  const tracking = headers.indexOf("tracking_number");
  if (email < 0 || tracking < 0 || dataRows.length < 10) return false;
  return dataRows.every((cells) => {
    const e = (cells[email] || "").trim();
    const t = (cells[tracking] || "").trim();
    return e.endsWith("@example.com") && (t === "" || t.startsWith("1ZTEST"));
  });
}

// Moves every order_date and ship_date by the same number of business days, so that
// the sample's newest order date (the day it was set up for) becomes today. Gaps
// between dates stay the same, so each order keeps its processing time and flags.
function moveSampleDates(headers, dataRows) {
  const columns = ["order_date", "ship_date"].map((c) => headers.indexOf(c));
  const orderDates = dataRows.map((cells) => parseDate(cells[columns[0]] || "")).filter(Boolean);
  if (!orderDates.length) return;
  const setUpFor = new Date(Math.max(...orderDates));
  const shift = TODAY >= setUpFor ? businessDaysBetween(setUpFor, TODAY) : -businessDaysBetween(TODAY, setUpFor);
  if (!shift) return;
  for (const cells of dataRows) {
    for (const i of columns) {
      const date = parseDate(cells[i] || "");
      if (date) cells[i] = isoDate(shiftByBusinessDays(date, shift));
    }
  }
}

// n business days later (or earlier, if n is negative). A weekend date keeps its
// distance from the next business day, so a Saturday order stays a Saturday order.
function shiftByBusinessDays(date, n) {
  const anchor = nextBusinessDay(date);
  const offset = Math.round((anchor - date) / 86400000);
  let d = anchor;
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, Math.sign(n));
    if (isBusinessDay(d)) left--;
  }
  return addDays(d, -offset);
}

async function loadSample() {
  messages.replaceChildren();
  try {
    const response = await fetch("data/sample_orders.csv", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    loadOrders(await response.text(), "sample_orders.csv");
  } catch {
    // Some browsers block this on pages opened straight from a file.
    showMessage("error", "The sample couldn't be loaded from here.", [
      "Open data/sample_orders.csv from the project folder (or download it from the field guide) and drop it on the upload box.",
    ]);
  }
}

// --- Weather ---

// Which places and days could hold a package up (no route data, so only the ends):
// - delivered (Expected window over): nothing
// - in transit: the destination on each remaining delivery day
// - not shipped yet: also the origin on the estimated ship day
// UPS runs Saturdays but not Sundays, so Saturdays in a window are checked too.
function weatherChecks(o) {
  if (o.status === "delivered") return [];
  const checks = [];
  if (o.status === "not-shipped") {
    checks.push({ place: "Origin", zip: o.originZip, coords: o.originCoords, day: o.shipDate });
  }
  const from = o.expectedEarliest > TODAY ? o.expectedEarliest : TODAY;
  for (let day = from; day <= o.expectedLatest; day = addDays(day, 1)) {
    if (day.getUTCDay() !== 0) {
      checks.push({ place: "Destination", zip: o.destinationZip, coords: o.destinationCoords, day });
    }
  }
  return checks;
}

// Looks up each needed ZIP once (weather.js caches it) and re-evaluates every
// order that uses it as its answer arrives. The table is usable meanwhile.
function checkWeatherFor(orders) {
  const loadId = state.loadId;
  const zips = new Map();
  for (const o of orders) {
    for (const c of weatherChecks(o)) {
      zips.set(c.zip, c.coords);
      state.weather.delete(c.zip);
    }
  }
  for (const o of orders) evaluateWeather(o);
  render();

  checkWeatherForZips(zips, (zip, result) => {
    if (loadId !== state.loadId) return; // a newer file was loaded
    state.weather.set(zip, result);
    for (const o of state.orders) evaluateWeather(o);
    render();
  });
}

// Sets o.weather = { status, reasons, unknown, noForecast, delayedTo, breaksPromise } and o.risk.
function evaluateWeather(o) {
  const checks = weatherChecks(o);
  const w = { status: checks.length ? "ok" : "skipped", reasons: [], unknown: [], noForecast: [] };
  for (const c of checks) {
    const real = state.weather.get(c.zip);
    const location = state.demoWeather ? withDemoStorms(c.zip, real, TODAY) : real;
    if (!location) {
      w.status = "pending";
    } else if (location.error) {
      if (w.status !== "pending") w.status = "error";
      w.unknown.push(location.error);
    } else {
      const day = isoDate(c.day);
      const { reasons, noForecast } = weatherOnDay(location, day);
      for (const r of reasons) w.reasons.push({ ...r, place: c.place, day: c.day });
      if (noForecast) w.noForecast.push(c.day);
    }
  }
  // Likely-delay weather costs one delivery day (Saturdays count; Sundays and UPS
  // holidays don't). It only matters if that pushes delivery past the promise.
  w.delayedTo = w.reasons.length ? nextDeliveryDay(o.expectedLatest) : null;
  w.breaksPromise = Boolean(w.delayedTo && w.delayedTo > o.promised);
  o.weather = w;
  // An order already at risk or late by its dates keeps that flag.
  o.risk = o.timingRisk === "on-track" && w.breaksPromise ? "at-risk" : o.timingRisk;
}

function toggleDemoWeather() {
  state.demoWeather = !state.demoWeather;
  if (state.filter === "weather") state.filter = "all"; // its orders may disappear
  for (const o of state.orders) evaluateWeather(o);
  render();
}

function retryWeather() {
  checkWeatherFor(state.orders.filter((o) => o.weather.status === "error"));
}

function renderWeatherStatus() {
  const box = document.getElementById("weather-status");
  const orders = state.orders;
  const count = (status) => orders.filter((o) => o.status === status).length;
  const checked = orders.filter((o) => o.weather.status !== "skipped");
  const pending = checked.filter((o) => o.weather.status === "pending").length;
  const failed = checked.filter((o) => o.weather.status === "error");
  const hit = checked.filter((o) => o.weather.reasons.length).length;
  const pushedPast = checked.filter((o) => o.weather.breaksPromise).length;
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const mix =
    `${count("not-shipped")} not shipped yet, ${count("in-transit")} in transit, ` +
    `${count("delivered")} likely delivered (not checked).`;

  if (pending) {
    box.replaceChildren(
      el("p", { class: "weather-status", text: `Checking weather for ${n(pending, "order")}… ${mix}` })
    );
  } else if (failed.length) {
    const reasons = [...new Set(failed.flatMap((o) => o.weather.unknown))].join(", ");
    const retry = el("button", { type: "button", class: "link-button", text: "Retry" });
    retry.addEventListener("click", retryWeather);
    box.replaceChildren(
      el("p", { class: "message warn", role: "status" }, [
        `Couldn't check weather for ${n(failed.length, "order")} (${reasons}). ` +
          "Those orders aren't flagged for weather. ",
        retry,
      ])
    );
  } else {
    box.replaceChildren(
      el("p", { class: "weather-status" }, [
        `Weather checked for ${n(checked.length, "order")}: ${hit} likely delayed a day, ` +
          `${pushedPast} of them past the promise. ${mix} `,
        state.demoWeather ? el("strong", { text: "Demo storms are on: weather marked (demo) is made up." }) : null,
      ])
    );
  }
}

// Returns an order object, or { id, error } describing the first problem found.
function parseOrder(get) {
  const id = get("order_id");
  if (!id) return { id, error: "order_id is empty." };

  const orderDate = parseDate(get("order_date"));
  if (!orderDate) {
    return { id, error: `order_date "${get("order_date")}" isn't a date. Use YYYY-MM-DD.` };
  }

  const value = parseMoney(get("order_value"));
  if (value === null) return { id, error: `order_value "${get("order_value")}" isn't a number.` };

  const originZip = cleanZip(get("origin_zip"));
  if (!originZip) return { id, error: `origin_zip "${get("origin_zip")}" isn't a 5-digit ZIP.` };
  const destinationZip = cleanZip(get("destination_zip"));
  if (!destinationZip) {
    return { id, error: `destination_zip "${get("destination_zip")}" isn't a 5-digit ZIP.` };
  }

  // A blank ship_date means not shipped yet: assume 1 business day of processing,
  // or the next shipping day from today if that's already passed.
  const shipped = get("ship_date") !== "";
  const shipDate = shipped ? parseDate(get("ship_date")) : estimatedShipDate(orderDate);
  if (!shipDate) {
    return { id, error: `ship_date "${get("ship_date")}" isn't a date. Use YYYY-MM-DD, or leave it blank if not shipped.` };
  }

  if (shipped && shipDate < orderDate) {
    return { id, error: `ship_date ${get("ship_date")} is before order_date ${get("order_date")}.` };
  }

  const estimate = estimateDelivery({
    originZip,
    destinationZip,
    serviceLevel: get("ups_service_level"),
    shipDate,
  });
  if (estimate.error) return { id, error: estimate.error };

  // Promised is set at checkout from the order date; Expected comes from the ship date.
  const promised = promisedDate(orderDate);
  const timing = assessRisk(promised, estimate.earliest, estimate.promised);

  const email = get("customer_email");
  return {
    id,
    customerName: get("customer_name"),
    // A malformed email is treated as missing; the notify panel says so.
    customerEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
    trackingNumber: shipped ? get("tracking_number").replace(/\s+/g, "") : "",
    orderDate,
    value,
    productName: get("product_name"),
    productDescription: get("product_description"),
    originZip,
    destinationZip,
    shipDate,
    shipped,
    status: !shipped ? "not-shipped" : estimate.promised < TODAY ? "delivered" : "in-transit",
    processingDays: processingDays(orderDate, shipDate),
    serviceLabel: estimate.serviceLabel,
    miles: estimate.miles,
    zone: estimate.zone,
    minDays: estimate.minDays,
    maxDays: estimate.maxDays,
    approximateLocation: estimate.approximateLocation,
    originCoords: estimate.originCoords,
    destinationCoords: estimate.destinationCoords,
    promised,
    expectedEarliest: estimate.earliest,
    expectedLatest: estimate.promised,
    ...timing,
    risk: timing.timingRisk,
    weather: { status: "skipped", reasons: [], unknown: [], noForecast: [] },
  };
}

// The merchant's normal order-to-ship time. Unshipped orders are assumed to take
// this long, and a shipped order that took longer has a "processing delay".
const NORMAL_PROCESSING_DAYS = 1;

function estimatedShipDate(orderDate) {
  const planned = deliveryDate(orderDate, NORMAL_PROCESSING_DAYS);
  const soonest = nextBusinessDay(TODAY);
  return planned > soonest ? planned : soonest;
}

// Risk from dates alone (weather is added later by evaluateWeather):
// "late": even the earliest expected date misses the promise.
// "at-risk": the expected window runs past the promise.
// "on-track": the whole expected window is on or before the promise.
function assessRisk(promised, earliest, latest) {
  if (earliest > promised) return { timingRisk: "late", daysLate: businessDaysBetween(promised, latest) };
  if (latest > promised) return { timingRisk: "at-risk", daysLate: businessDaysBetween(promised, latest) };
  return { timingRisk: "on-track", daysLate: 0 };
}

const RISK_ORDER = { late: 0, "at-risk": 1, "on-track": 2 };
const isFlagged = (o) => o.risk !== "on-track";

// What each reason means in general; shown first in the reason label's tooltip,
// followed by the order's own details.
const REASON_HELP = {
  processing:
    "Processing delay: the time between the order and the shipment (picking, packing and printing the " +
    `label) took longer than the normal ${NORMAL_PROCESSING_DAYS} business day${NORMAL_PROCESSING_DAYS === 1 ? "" : "s"}. Every extra day ` +
    `of processing uses up part of the ${PROMISE_BUSINESS_DAYS}-business-day promise before UPS even has the package.`,
  transit:
    "Transit time: the UPS service chosen takes too long over this distance to fit inside the " +
    `${PROMISE_BUSINESS_DAYS}-business-day promise, even when the order ships on time. A faster service ` +
    "or a longer promise would fix it.",
  weather:
    "Weather: a severe-weather or emergency alert, or more than 8 inches of snow, is expected at the " +
    "warehouse on the ship day or at the delivery address while the package is due. That usually adds about " +
    "a day, which would push delivery past the promise.",
  other: "Other: the dates miss the promise for a reason the checker can't pin down.",
};

// Why a flagged order may miss its promise; more than one can apply.
//   processing: it shipped (or will ship) later than normal processing allows
//   transit:    even with normal processing, the service/route takes too long for the promise
//   weather:    likely-delay weather pushes delivery past the promise
//   other:      date-flagged, but neither of the above explains it
// Returns [{ code, label, detail }].
function delayReasons(o) {
  if (!isFlagged(o)) return [];
  const reasons = [];

  if (o.timingRisk !== "on-track") {
    const normalShip = deliveryDate(o.orderDate, NORMAL_PROCESSING_DAYS);
    if (o.shipDate > normalShip) {
      reasons.push({
        code: "processing",
        label: "Processing delay",
        detail: o.shipped
          ? `Took ${plural(o.processingDays, "business day")} to ship; normal is ${NORMAL_PROCESSING_DAYS}.`
          : `Not shipped yet: the earliest it can ship is ${fmtDate(o.shipDate)}; normally it would have shipped ${fmtDate(normalShip)}.`,
      });
    }
    if (deliveryDate(normalShip, o.maxDays) > o.promised) {
      const days = o.minDays === o.maxDays ? `${o.maxDays}` : `${o.minDays}–${o.maxDays}`;
      reasons.push({
        code: "transit",
        label: "Transit time",
        detail:
          `${o.serviceLabel}${o.zone ? ` (zone ${o.zone}, ${Math.round(o.miles)} mi)` : ""} takes ${days} business days: ` +
          `too long for the ${PROMISE_BUSINESS_DAYS}-business-day promise even with normal processing.`,
      });
    }
    if (!reasons.length) {
      reasons.push({ code: "other", label: "Other", detail: "The dates miss the promise for a reason the app can't pin down." });
    }
  }

  if (o.weather.breaksPromise) {
    reasons.push({
      code: "weather",
      label: "Weather",
      detail:
        o.weather.reasons.map((r) => `${r.place}: ${r.text} (${fmtDate(r.day)})`).join("; ") +
        `. Could push delivery to ${fmtDate(o.weather.delayedTo)}.`,
    });
  }
  return reasons;
}

// Which orders the table shows; set by clicking a summary box.
const FILTERS = {
  all: () => true,
  attention: isFlagged,
  weather: (o) => o.weather.breaksPromise,
  ground: (o) => o.zone != null,
  air: (o) => o.zone == null,
};
const FILTER_HINTS = {
  all: "Show all orders",
  attention: "Show only orders that need attention",
  weather: "Show only orders that weather could push past the promise",
  ground: "Show only UPS Ground orders",
  air: "Show only air orders",
};

// --- Rendering ---

const STATUS_ORDER = {
  "not-shipped": 0,
  missing: 1,
  "label-created": 2,
  "in-transit": 3,
  "out-for-delivery": 4,
  delivered: 5,
};

const COLUMNS = [
  { key: "order", label: "Order", sortValue: (o) => o.id },
  // The order value is shown under the product name (no column of its own, to keep the table narrow).
  { key: "product", label: "Product", sortValue: (o) => o.productName.toLowerCase() },
  { key: "route", label: "Route", sortValue: (o) => o.miles },
  { key: "service", label: "Service", sortValue: (o) => o.maxDays * 100 + (o.zone ?? 0) },
  { key: "ship", label: "Ship date", sortValue: (o) => o.shipDate.getTime() },
  // Where the package is now; reads left to right: shipped, status now, promised, expected.
  {
    key: "status",
    label: "Status",
    title: "Shipment progress. Simulated from the dates for now, not live UPS tracking.",
    sortValue: (o) => STATUS_ORDER[shipmentProgress(o)?.stage ?? "not-shipped"],
  },
  { key: "promised", label: "Promised", sortValue: (o) => o.promised.getTime() },
  // Last on purpose: weather scoring will move this date, while Promised stays fixed.
  // Sorting puts late orders first, then at-risk, then on-track.
  {
    key: "expected",
    label: "Expected",
    title:
      "Our estimate: ship date + typical UPS transit time for the service and distance, " +
      "skipping weekends and holidays. Not UPS's scheduled delivery date.",
    sortValue: (o) => RISK_ORDER[o.risk] * 1e6 - o.daysLate * 1e3 + o.expectedLatest.getTime() / 864e5,
  },
];

function cellContent(key, o) {
  switch (key) {
    case "order": {
      const notified = notifiedOn(o.id);
      return el("div", { class: "order-cell" }, [
        selectBox(o),
        el("div", {}, [
          el("strong", { class: "nowrap", text: o.id }),
          o.customerName ? el("span", { class: "sub", text: o.customerName }) : null,
          el("span", { class: "sub" }, [
            "Ordered ",
            el("span", { class: "nowrap", text: fmtDate(o.orderDate) }),
          ]),
          notified
            ? el("span", { class: "sub notified", text: `Notified ${shortFormat.format(parseDate(notified))}` })
            : null,
        ]),
      ]);
    }
    case "product":
      return el("div", { class: "product-cell", title: o.productDescription }, [
        el("span", { text: o.productName }),
        el("span", { class: "sub price", text: fmtMoney(o.value) }),
        el("span", { class: "sub", text: o.productDescription }),
      ]);
    case "route":
      return el("div", {}, [
        el("span", { class: "nowrap", text: `${o.originZip} → ${o.destinationZip}` }),
        el("span", {
          class: "sub",
          text: `${Math.round(o.miles).toLocaleString("en-US")} mi${o.approximateLocation ? " (approx.)" : ""}`,
        }),
      ]);
    case "service":
      return el("div", { class: "service-cell" }, [
        el("span", { text: o.serviceLabel }),
        el("span", {
          class: "sub",
          text: o.zone
            ? `Zone ${o.zone} · ${o.minDays}–${o.maxDays} days`
            : `${o.maxDays} ${o.maxDays === 1 ? "day" : "days"}`,
        }),
      ]);
    case "ship":
      // Unshipped: the estimated ship date. Processing time isn't shown here; it's in the
      // "Processing delay" reason when it matters.
      if (!o.shipped) {
        return el("div", {}, [
          el("span", { class: "nowrap", text: fmtDate(o.shipDate) }),
          el("span", { class: "sub", text: "estimated" }),
        ]);
      }
      return el("span", { class: "nowrap", text: fmtDate(o.shipDate) });
    case "status":
      return o.shipped ? progressLine(o) : el("span", { class: "not-shipped", text: "Not shipped" });
    case "promised":
      return el("span", { class: "promised nowrap", text: fmtDate(o.promised) });
    case "expected":
      return el("div", {}, [
        el("span", { class: "nowrap", text: fmtRange(o.expectedEarliest, o.expectedLatest) }),
        riskBadge(o),
        weatherNote(o),
      ]);
  }
}

// The Status column for shipped orders: where the package is (see tracking.js), linked to UPS.
function progressLine(o) {
  const p = shipmentProgress(o);
  if (!p) return null;
  if (p.stage === "missing") {
    return el("span", {
      class: "sub progress progress-missing",
      text: p.text,
      title: "This order has a ship date but no tracking number in the file.",
    });
  }
  return el("span", { class: `sub progress progress-${p.stage}` }, [
    el("a", {
      href: p.trackingUrl,
      target: "_blank",
      rel: "noopener",
      text: p.text,
      title:
        `${p.simulated ? "Simulated from the dates, not live UPS tracking. " : ""}` +
        `Tracking # ${p.trackingNumber}: opens the UPS tracking page.`,
    }),
  ]);
}

// Under the Expected date: what weather could delay it, where and when; or why
// weather wasn't checked or is unknown.
function weatherNote(o) {
  const w = o.weather;
  // Delivered orders aren't checked; their status shows once, in the Status column.
  if (w.status === "skipped") return null;

  const lines = [];
  // One line per place + problem, listing the days it applies to.
  const grouped = new Map();
  for (const r of w.reasons) {
    const key = `${r.place}: ${r.text}`;
    if (!grouped.has(key)) grouped.set(key, { days: [], detail: r.detail });
    grouped.get(key).days.push(r.day);
  }
  // Orange when the weather day breaks the promise, gray when the order still makes it.
  const tone = w.breaksPromise ? "sub weather-alert" : "sub";
  for (const [key, { days, detail }] of grouped) {
    const when = days.map((d) => weekdayFormat.format(d)).join(", ");
    const where = key.startsWith("Origin")
      ? `At the warehouse (ZIP ${o.originZip}) on the day the order should ship`
      : `At the delivery address (ZIP ${o.destinationZip}) while the package is due`;
    lines.push(el("span", {
      class: `${tone} has-tip`,
      text: `${key} (${when})`,
      title: `${where}: ${days.map(fmtDate).join(", ")}. ${detail}`,
    }));
  }
  if (w.delayedTo) {
    lines.push(el("span", {
      class: tone,
      text: `+1 day: ${fmtDate(w.delayedTo)}, ${w.breaksPromise ? "past the promise" : "still on time"}`,
      title: "Likely-delay weather is counted as one extra delivery day (UPS delivers Saturdays, not Sundays or holidays).",
    }));
  }
  if (w.status === "error") {
    lines.push(el("span", { class: "sub", text: "weather unknown", title: `Couldn't check: ${w.unknown.join(", ")}` }));
  }
  return lines.length ? el("span", {}, lines) : null;
}

const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function fmtProcessing(days) {
  return days === 0 ? "same-day processing" : `${plural(days, "business day")} processing`;
}

// The flag (At risk / Late) plus a label for each reason; hover a label for details.
function riskBadge(o) {
  if (!isFlagged(o)) return null;
  let badge;
  if (o.timingRisk === "on-track") {
    // Flagged only because of weather.
    badge = el("span", {
      class: "badge warn",
      text: "At risk",
      title: `Weather could push delivery to ${fmtDate(o.weather.delayedTo)}, past the ${fmtDate(o.promised)} promise.`,
    });
  } else {
    const days = plural(o.daysLate, "day");
    const [cls, text] = o.risk === "late" ? ["bad", `Late · ${days}`] : ["warn", `At risk · ${days}`];
    const transit = o.minDays === o.maxDays ? `${o.maxDays}` : `${o.minDays}–${o.maxDays}`;
    badge = el("span", {
      class: `badge ${cls}`,
      text,
      title:
        `${o.shipped ? "" : "Estimated "}${fmtProcessing(o.processingDays)} + ${transit} business days ` +
        `${o.serviceLabel} transit runs past the ${PROMISE_BUSINESS_DAYS}-business-day promise.`,
    });
  }
  return el("span", { class: "sub" }, [
    badge,
    el(
      "span",
      { class: "reason-chips" },
      delayReasons(o).map((r) =>
        el("span", { class: `reason-chip reason-${r.code}`, text: r.label, title: `${REASON_HELP[r.code]}\n\nThis order: ${r.detail}` })
      )
    ),
  ]);
}

function renderSummary() {
  const orders = state.orders;
  const times = orders.map((o) => o.shipDate.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  const ground = orders.filter((o) => o.zone).length;

  const late = orders.filter((o) => o.risk === "late").length;
  const atRisk = orders.filter((o) => o.risk === "at-risk").length;
  const flagged = late + atRisk;
  const weatherDelays = orders.filter(FILTERS.weather).length;

  document.getElementById("summary").replaceChildren(
    statBox(String(flagged), flagged ? `Need attention (${late} late, ${atRisk} at risk)` : "Need attention", {
      filter: "attention",
      count: flagged,
      tone: flagged > 0 ? "risk" : "",
    }),
    statBox(String(weatherDelays), weatherDelays === 1 ? "Weather delay" : "Weather delays", {
      filter: "weather",
      count: weatherDelays,
      tone: weatherDelays > 0 ? "weather" : "",
    }),
    statBox(orders.length.toLocaleString("en-US"), "Orders", { filter: "all", count: orders.length }),
    statBox(isoDate(first) === isoDate(last) ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`, "Ship dates"),
    statBox(String(ground), "Ground", { filter: "ground", count: ground }),
    statBox(String(orders.length - ground), "Air", { filter: "air", count: orders.length - ground })
  );

  const shown = orders.filter(FILTERS[state.filter]).length;
  const notes = [`Showing ${shown} of ${orders.length} orders.`];
  const missingTracking = orders.filter((o) => o.shipped && !o.trackingNumber).length;
  if (missingTracking) {
    notes.push(`${missingTracking} shipped ${missingTracking === 1 ? "order has" : "orders have"} no tracking number.`);
  }
  if (TRACKING_SOURCE === "simulated" && orders.some((o) => o.trackingNumber)) {
    notes.push("Shipment progress is simulated from the dates, not live UPS tracking.");
  }
  // Demo storms switch: a real button so it's easy to find.
  const demo = el("button", {
    type: "button",
    class: `button-secondary demo-toggle${state.demoWeather ? " is-on" : ""}`,
    "aria-pressed": String(state.demoWeather),
    text: state.demoWeather ? "Demo storms: on" : "Demo storms: off",
    title: "Adds made-up storms at a few sample locations, to show how weather delays look. Always marked (demo).",
  });
  demo.addEventListener("click", toggleDemoWeather);
  document.getElementById("filter-bar").replaceChildren(
    el("div", { class: "filter-row" }, [el("p", { class: "filter-status", text: notes.join(" ") }), demo])
  );
}

// A summary box. With a `filter` (and something to show), clicking it filters the
// table; clicking the active box again goes back to all orders.
// tone: "risk" (red) or "weather" (blue) when the box has something to show.
function statBox(value, label, { filter, count = 0, tone = "" } = {}) {
  const content = [
    el("span", { class: "stat-value", text: value }),
    el("span", { class: "stat-label", text: label }),
  ];
  const cls = `stat${tone ? ` stat-${tone}` : ""}`;
  if (!filter || count === 0) return el("div", { class: cls }, content);

  const active = state.filter === filter;
  const button = el(
    "button",
    {
      type: "button",
      class: cls,
      "aria-pressed": String(active),
      title: active && filter !== "all" ? "Show all orders" : FILTER_HINTS[filter],
    },
    content
  );
  button.addEventListener("click", () => setFilter(active ? "all" : filter));
  return button;
}

function renderTable() {
  const columns = COLUMNS;
  const { key, dir } = state.sort;
  const sortCol = columns.find((c) => c.key === key) || columns[0];

  const shown = state.orders.filter(FILTERS[state.filter]);
  const sorted = [...shown].sort((a, b) => {
    const va = sortCol.sortValue(a);
    const vb = sortCol.sortValue(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const table = document.getElementById("orders-table");
  table.tHead.replaceChildren(
    el(
      "tr",
      {},
      columns.map((c) => {
        const th = el("th", { scope: "col", class: c.num ? "num" : "" }, [
          el("button", { type: "button", text: c.label, ...(c.title ? { title: c.title } : {}) }),
        ]);
        if (c.key === sortCol.key) th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
        th.querySelector("button").addEventListener("click", () => {
          state.sort = { key: c.key, dir: c.key === sortCol.key ? -dir : 1 };
          renderTable();
        });
        return th;
      })
    )
  );

  table.tBodies[0].replaceChildren(
    ...sorted.map((o) =>
      el(
        "tr",
        {},
        columns.map((c) => el("td", { "data-label": c.label, class: c.num ? "num" : "" }, [cellContent(c.key, o)]))
      )
    )
  );
}

function render() {
  renderSummary();
  renderTable();
  renderWeatherStatus();
  renderSelectionBar();
}

// --- Selecting orders for a delay notice ---

// Delivered orders can't be selected: there's nothing left to warn about.
const canNotify = (o) => o.status !== "delivered";

function selectBox(o) {
  const box = el("input", { type: "checkbox", "aria-label": `Select ${o.id}` });
  box.checked = state.selected.has(o.id);
  box.disabled = !canNotify(o);
  if (box.disabled) box.title = "Likely delivered";
  box.addEventListener("change", () => {
    if (box.checked) state.selected.add(o.id);
    else state.selected.delete(o.id);
    renderSelectionBar();
  });
  return box;
}

function setSelection(ids) {
  state.selected = new Set(ids);
  renderTable();
  renderSelectionBar();
}

function renderSelectionBar() {
  const count = state.selected.size;
  const needAttention = state.orders.filter((o) => isFlagged(o) && canNotify(o));

  const selectFlagged = el("button", {
    type: "button",
    class: "button-secondary",
    text: `Select all that need attention (${needAttention.length})`,
  });
  selectFlagged.disabled = !needAttention.length;
  selectFlagged.addEventListener("click", () => setSelection(needAttention.map((o) => o.id)));

  const clear = el("button", { type: "button", class: "link-button", text: "Clear" });
  clear.addEventListener("click", () => setSelection([]));

  const notify = el("button", { type: "button", class: "button-primary", text: "Notify customers…" });
  notify.disabled = !count;
  notify.addEventListener("click", openNotifyDialog);

  const parts = [selectFlagged, el("span", { class: "selection-count", text: `${count} selected` })];
  if (count) parts.push(clear);
  parts.push(notify);
  document.getElementById("selection-bar").replaceChildren(...parts);
}

// Set by clicking a summary box.
function setFilter(filter) {
  state.filter = filter;
  render();
}

// --- Upload wiring ---

fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = ""; // allow re-choosing the same file
});

document.getElementById("load-sample").addEventListener("click", loadSample);

["dragenter", "dragover"].forEach((type) =>
  dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragging");
  })
);
["dragleave", "drop"].forEach((type) =>
  dropZone.addEventListener(type, () => dropZone.classList.remove("dragging"))
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

// Stop the browser from opening a file dropped outside the drop zone.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
