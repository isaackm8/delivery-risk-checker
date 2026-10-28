# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For what the app does and why, read [README.md](README.md) first; it isn't repeated here.

## Commands

There is no build step, linter, package manager or automated test suite. Verification is manual, in a browser (see Testing changes).

```bash
# Run the app (what the user does): open index.html directly, e.g. by double-clicking it

# Serve the folder for testing in the browser pane (same as the "static" config in .claude/launch.json)
python -m http.server 8000 --bind 127.0.0.1

# Rebuild the ZIP lookup table from a Census ZCTA Gazetteer file (pipe-separated .txt)
python -I tools/build_zip_coords.py path/to/2025_Gaz_zcta_national.txt data/zip-coords.js
```

## How the user works

- **Wait for an explicit go-ahead before starting each new piece of work.** Approval of one step (e.g. a download) is not approval for the next phase (e.g. building). Ask questions before changing anything non-trivial.
- Explain each step in plain language as you go; the user approves steps one at a time.
- Commit only when asked, and push only when asked (they are separate approvals).
- Never commit the `.claude/` folder (local test-server config).
- Git identity for this repo is set locally to `isaackm8 <isaackm8@gmail.com>`; leave it alone. Remote: `https://github.com/isaackm8/delivery-risk-checker`, branch `main`.

## The app

Plain HTML, CSS and JavaScript, no build step, no dependencies, no network. The user opens `index.html` by double-clicking it.

- Scripts load as plain `<script>` tags in a fixed order (`data/zip-coords.js`, `js/csv.js`, `js/transit.js`, `js/app.js`) and share globals. **Don't switch to ES modules**: browsers block them on `file://`, which would break double-click.
- Build every DOM node with the `el()` helper in `js/app.js` (sets `textContent`). Never use `innerHTML` with CSV data.
- Dates are UTC midnight `Date` objects (`parseDate`, `isoDate` in `js/transit.js`) so a timezone can't shift a day.

### How an upload flows through the code

1. `handleFile` (app.js) reads the file with `FileReader`; `parseCSV` (csv.js) turns the text into rows of strings.
2. `loadOrders` normalizes headers (lowercase, spaces to `_`) and checks them against `REQUIRED_COLUMNS`. A missing column stops the load.
3. `parseOrder` validates one row (`cleanZip` pads Excel-stripped ZIPs and trims ZIP+4; `parseMoney`; `parseDate`) and returns either an order or `{ id, error }`. Bad rows are skipped and listed in a warning, never thrown.
4. For a valid row it calls transit.js: `estimateDelivery` (ZIP lookup, miles, zone, service days, expected window), `promisedDate(orderDate)` and `processingDays`, then `assessRisk` sets `risk` and `daysLate`.
5. Orders go into `state` (`orders`, `filter`, `sort`); `render()` = `renderSummary()` (the summary boxes, built by `statBox`) + `renderTable()`. Clicking a box calls `setFilter`, which re-renders.

**Naming trap:** `estimateDelivery()` returns `earliest` and `promised`, but that `promised` is the **latest expected delivery** (slow end of transit), not the customer's promise. `parseOrder` renames them to `expectedEarliest` / `expectedLatest` and sets the real `promised` from `promisedDate(orderDate)`.

**ZIP lookup:** `data/zip-coords.js` defines `window.ZIP_COORDS` (ZIP to `[lat, lon]`). `locateZip` falls back to the average location of the 3-digit prefix (built lazily by `buildZip3Centers`) and marks the order `approximateLocation`, shown as "(approx.)".

### Where to make common changes

- **A table column:** add an entry to `COLUMNS` (key, label, `sortValue`) and a matching `case` in `cellContent`. Recheck the 1024 px fit.
- **A summary filter:** add a predicate to `FILTERS`, a tooltip to `FILTER_HINTS`, and a `statBox(...)` call in `renderSummary`.
- **A CSV column:** add it to `REQUIRED_COLUMNS` and read it with `get("<name>")` in `parseOrder`; update the README's CSV table.
- **Transit or promise rules:** the constants at the top of `js/transit.js`.

## Business rules (in `js/transit.js`)

These are the user's decisions. Don't change them without asking.

- **Promised** = order date + `PROMISE_BUSINESS_DAYS` (7) business days, the same for every service level. Processing doesn't prioritize faster services.
- **Expected** = ship date + transit, shown as a window: earliest = fewest transit days, latest = most. Air uses `AIR_SERVICES` (fixed days, so a single date). Ground uses `GROUND_ZONES`: the zone comes from straight-line miles between ZIP centroids, and each zone's mileage limit is inclusive (exactly 150 mi is zone 2).
- **Processing** = business days from the order date to the ship date, not counting the order day. Label it "business days" in the UI.
- Business days skip weekends and six UPS holidays (`upsHolidays`), with weekend-observed shifts. A weekend or holiday order/pickup counts from the next business day.
- Ground is invalid to/from Hawaii and between Alaska and the mainland; Ground within Alaska is fine.
- Flags: **Late** if the earliest expected date is after Promised; **At risk** if only the latest is. Days late are business days.
- Weather is the planned next feature: it will push Expected later. Promised never changes.

## Data

- `data/sample_orders.csv` is made-up data. Its order dates are designed to produce exactly 4 flagged orders (ORD-20498 late; ORD-20488, ORD-20513, ORD-20525 at risk). If you change the data or rules, recheck that list and update the README table.
- `data/zip-coords.js` is generated. Don't edit it by hand; rebuild it (see Commands). The source file comes from census.gov (URL in the README); keep the raw download out of the repo.

## UI conventions

- Column order: Order, Product, Value, Route, Service, Ship date, Promised, **Expected last** (weather will move it).
- Laptop: a table that must fit at 1024 px without sideways scrolling; Promised and Expected are pinned right when narrower. At 720 px and below: one card per order.
- The summary boxes (Need attention, Orders, Ground, Air) are the filters; there is no checkbox.
- Colors are CSS variables on `:root` with a dark-mode set; keep both in sync.

## Testing changes

- Serve the folder (see Commands, or `preview_start` with the `static` config) and load it in the browser pane; the pane can't run scripts from `file://`.
- The browser caches `styles.css` and `js/*.js`: `fetch(file, {cache: "reload"})` each changed file, then reload.
- Upload by setting `#file-input.files` from a `DataTransfer` and dispatching `change`; wait for the page's `load` first.
- Check the sample file (50 orders, 4 flagged), a deliberately broken CSV, and widths 1024 px and phone. Run click sequences one after another, not in parallel.
