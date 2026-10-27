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

const state = { orders: [], filter: "all", sort: { key: "ship", dir: 1 } };

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
    showMessage("error", `"${fileName}" has no orders in it.`);
    return;
  }

  const headers = rows[0].map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    results.hidden = true;
    showMessage("error", `"${fileName}" is missing ${missing.length === 1 ? "a column" : "columns"}:`, [
      missing.join(", "),
      `Expected columns: ${REQUIRED_COLUMNS.join(", ")}.`,
    ]);
    return;
  }

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

  const shipDate = parseDate(get("ship_date"));
  if (!shipDate) {
    return { id, error: `ship_date "${get("ship_date")}" isn't a date. Use YYYY-MM-DD.` };
  }

  if (shipDate < orderDate) {
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

  return {
    id,
    orderDate,
    value,
    productName: get("product_name"),
    productDescription: get("product_description"),
    originZip,
    destinationZip,
    shipDate,
    processingDays: processingDays(orderDate, shipDate),
    serviceLabel: estimate.serviceLabel,
    miles: estimate.miles,
    zone: estimate.zone,
    minDays: estimate.minDays,
    maxDays: estimate.maxDays,
    approximateLocation: estimate.approximateLocation,
    promised,
    expectedEarliest: estimate.earliest,
    expectedLatest: estimate.promised,
    ...assessRisk(promised, estimate.earliest, estimate.promised),
  };
}

// "late": even the earliest expected date misses the promise.
// "at-risk": the expected window runs past the promise.
// "on-track": the whole expected window is on or before the promise.
function assessRisk(promised, earliest, latest) {
  if (earliest > promised) return { risk: "late", daysLate: businessDaysBetween(promised, latest) };
  if (latest > promised) return { risk: "at-risk", daysLate: businessDaysBetween(promised, latest) };
  return { risk: "on-track", daysLate: 0 };
}

const RISK_ORDER = { late: 0, "at-risk": 1, "on-track": 2 };
const isFlagged = (o) => o.risk !== "on-track";

// Which orders the table shows; set by clicking a summary box.
const FILTERS = {
  all: () => true,
  attention: isFlagged,
  ground: (o) => o.zone != null,
  air: (o) => o.zone == null,
};
const FILTER_HINTS = {
  all: "Show all orders",
  attention: "Show only orders that need attention",
  ground: "Show only UPS Ground orders",
  air: "Show only air orders",
};

// --- Rendering ---

const COLUMNS = [
  { key: "order", label: "Order", sortValue: (o) => o.id },
  { key: "product", label: "Product", sortValue: (o) => o.productName.toLowerCase() },
  { key: "value", label: "Value", num: true, sortValue: (o) => o.value },
  { key: "route", label: "Route", sortValue: (o) => o.miles },
  { key: "service", label: "Service", sortValue: (o) => o.maxDays * 100 + (o.zone ?? 0) },
  { key: "ship", label: "Ship date", sortValue: (o) => o.shipDate.getTime() },
  { key: "promised", label: "Promised", sortValue: (o) => o.promised.getTime() },
  // Last on purpose: weather scoring will move this date, while Promised stays fixed.
  // Sorting puts late orders first, then at-risk, then on-track.
  {
    key: "expected",
    label: "Expected",
    sortValue: (o) => RISK_ORDER[o.risk] * 1e6 - o.daysLate * 1e3 + o.expectedLatest.getTime() / 864e5,
  },
];

function cellContent(key, o) {
  switch (key) {
    case "order":
      return el("div", {}, [
        el("strong", { class: "nowrap", text: o.id }),
        el("span", { class: "sub" }, [
          "Ordered ",
          el("span", { class: "nowrap", text: fmtDate(o.orderDate) }),
        ]),
      ]);
    case "product":
      return el("div", { class: "product-cell", title: o.productDescription }, [
        el("span", { text: o.productName }),
        el("span", { class: "sub", text: o.productDescription }),
      ]);
    case "value":
      return fmtMoney(o.value);
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
      return el("div", {}, [
        el("span", { class: "nowrap", text: fmtDate(o.shipDate) }),
        el("span", { class: "sub", text: fmtProcessing(o.processingDays) }),
      ]);
    case "promised":
      return el("span", { class: "promised nowrap", text: fmtDate(o.promised) });
    case "expected":
      return el("div", {}, [
        el("span", { class: "nowrap", text: fmtRange(o.expectedEarliest, o.expectedLatest) }),
        riskBadge(o),
      ]);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function fmtProcessing(days) {
  return days === 0 ? "same-day processing" : `${plural(days, "business day")} processing`;
}

function riskBadge(o) {
  if (!isFlagged(o)) return null;
  const days = plural(o.daysLate, "day");
  const [cls, text] = o.risk === "late" ? ["bad", `Late · ${days}`] : ["warn", `At risk · ${days}`];
  const transit = o.minDays === o.maxDays ? `${o.maxDays}` : `${o.minDays}–${o.maxDays}`;
  return el("span", { class: "sub" }, [
    el("span", {
      class: `badge ${cls}`,
      text,
      title:
        `${fmtProcessing(o.processingDays)} + ${transit} business days ${o.serviceLabel} transit ` +
        `runs past the ${PROMISE_BUSINESS_DAYS}-business-day promise.`,
    }),
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

  document.getElementById("summary").replaceChildren(
    statBox(String(flagged), flagged ? `Need attention (${late} late, ${atRisk} at risk)` : "Need attention", {
      filter: "attention",
      count: flagged,
      risk: flagged > 0,
    }),
    statBox(orders.length.toLocaleString("en-US"), "Orders", { filter: "all", count: orders.length }),
    statBox(isoDate(first) === isoDate(last) ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`, "Ship dates"),
    statBox(String(ground), "Ground", { filter: "ground", count: ground }),
    statBox(String(orders.length - ground), "Air", { filter: "air", count: orders.length - ground })
  );

  const shown = orders.filter(FILTERS[state.filter]).length;
  document.getElementById("filter-bar").replaceChildren(
    el("p", { class: "filter-status", text: `Showing ${shown} of ${orders.length} orders` })
  );
}

// A summary box. With a `filter` (and something to show), clicking it filters the
// table; clicking the active box again goes back to all orders.
function statBox(value, label, { filter, count = 0, risk = false } = {}) {
  const content = [
    el("span", { class: "stat-value", text: value }),
    el("span", { class: "stat-label", text: label }),
  ];
  const cls = `stat${risk ? " stat-risk" : ""}`;
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
          el("button", { type: "button", text: c.label }),
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
