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

# Move the sample orders' dates to be current (15 not shipped, 20 in transit, 15 delivered)
python -I tools/refresh_sample_dates.py [--today YYYY-MM-DD]
```

The app's "today" is the computer's date; `index.html?today=YYYY-MM-DD` overrides it (use this for repeatable tests).

## How the user works

- **Wait for an explicit go-ahead before starting each new piece of work.** Approval of one step (e.g. a download) is not approval for the next phase (e.g. building). Ask questions before changing anything non-trivial.
- Explain each step in plain language as you go; the user approves steps one at a time.
- Commit only when asked, and push only when asked (they are separate approvals).
- Never commit the `.claude/` folder (local test-server config).
- Git identity for this repo is set locally to user `isaackm8` with GitHub's private noreply email; leave it alone, and never put the user's personal email in files or commits (the repository is public). Remote: `https://github.com/isaackm8/delivery-risk-checker`, branch `main`.

## The app

Plain HTML, CSS and JavaScript, no build step, no dependencies. The user opens `index.html` by double-clicking it. The only network calls are to the NWS API (`js/weather.js`); everything else must keep working offline.

- Scripts load as plain `<script>` tags in a fixed order (`data/zip-coords.js`, `js/csv.js`, `js/transit.js`, `js/weather.js`, `js/app.js`, `js/notify.js`) and share globals. notify.js comes last because it uses app.js helpers (`el`, `fmtDate`, `state`, `render`); app.js only calls into it from event handlers and rendering, never at load. **Don't switch to ES modules**: browsers block them on `file://`, which would break double-click.
- Build every DOM node with the `el()` helper in `js/app.js` (sets `textContent`). Never use `innerHTML` with CSV data.
- Dates are UTC midnight `Date` objects (`parseDate`, `isoDate` in `js/transit.js`) so a timezone can't shift a day.

### How an upload flows through the code

1. `handleFile` (app.js) reads the file with `FileReader`; `parseCSV` (csv.js) turns the text into rows of strings.
2. `loadOrders` normalizes headers (lowercase, spaces to `_`) and checks them against `REQUIRED_COLUMNS`. A missing column stops the load.
3. `parseOrder` validates one row (`cleanZip` pads Excel-stripped ZIPs and trims ZIP+4; `parseMoney`; `parseDate`) and returns either an order or `{ id, error }`. Bad rows are skipped and listed in a warning, never thrown. A blank `ship_date` means not shipped: `shipped = false` and `shipDate` = `estimatedShipDate(orderDate)`.
4. For a valid row it calls transit.js: `estimateDelivery` (ZIP lookup, miles, zone, service days, expected window, `originCoords`, `destinationCoords`), `promisedDate(orderDate)` and `processingDays`, then `assessRisk` sets `timingRisk` and `daysLate`. `risk` starts equal to `timingRisk`. `status` is `not-shipped`, `delivered` (latest expected date before `TODAY`) or `in-transit`.
5. Orders go into `state` (`orders`, `filter`, `sort`, `loadId`, `weather`); `render()` = `renderSummary()` (the summary boxes, built by `statBox`) + `renderTable()` + `renderWeatherStatus()`. Clicking a box calls `setFilter`, which re-renders.
6. Then `checkWeatherFor(orders)` runs in the background. `weatherChecks(o)` lists the place + day pairs to check (none if delivered; destination on each remaining Mon–Sat day of the Expected window; plus origin on the ship day if not shipped). Each needed ZIP gets one `checkWeather(zip, coords)` (weather.js, 4 ZIPs at a time). As each answer lands in `state.weather`, `evaluateWeather` re-runs for every order: it calls `weatherOnDay(location, day)` per check, fills `o.weather` (`status`, `reasons`, `unknown`, `noForecast`, `delayedTo`, `breaksPromise`) and sets `risk` to `at-risk` if dates were on track and the one-day weather delay (`delayedTo` = `nextDeliveryDay(expectedLatest)`) lands after `promised`. Answers for an older file are dropped by comparing `state.loadId`.

**Risk fields:** filters, sorting and the summary use `risk` (dates + weather). `timingRisk` is dates only; `riskBadge` uses it to choose between "At risk · N days" and "At risk · weather".

**Weather data (weather.js):** `lookUpLocation` makes 3 requests per ZIP: `/alerts/active?point=` (includes alerts starting later), `/points/` (time zone + forecast grid URL), then the grid's `snowfallAmount` (mm per UTC time block). `snowByDay` spreads each block over its hours and sums per **local** calendar day of that place; alerts are matched to days by their local onset/end dates. `weatherCache` maps ZIP to a promise, so concurrent and repeat lookups share one set of requests for the whole page session; failures are removed so `retryWeather` can ask again. Because the cache lasts the session, reload the page between tests that fake weather data.

**Delay notices (notify.js):** row checkboxes (`selectBox`, in the Order cell) fill `state.selected`; `renderSelectionBar` draws "Select all that need attention", the count and **Notify customers…**, which calls `openNotifyDialog`. That builds one notice per selected order with `buildNotice` → `fillTemplate` (placeholders; `{delay_update}` picks a sentence by situation: flagged / weather but on time / nothing predicted; `{carrier_section}` by shipped + tracking number). The page never sends email: **Send all emails** is a simulation (the user's choice for this prototype) that marks every listed customer notified; the real paths are a per-customer `mailto:` draft link, copy, or CSV download. Opening a draft only shows "Draft opened" for this visit and does not mark the order. Clicking a recipient's name (`.recipient-button`) sets `previewId`, so the preview shows that customer. `localStorage` (keys `drc-notified`, `drc-notify-template`) remembers notified dates and the edited template; every access is wrapped so the page works without storage. Delivered orders can't be selected (`canNotify`). Optional CSV columns: `OPTIONAL_COLUMNS` in app.js (`customer_name`, `customer_email`, `tracking_number`); a malformed email is treated as missing, and tracking numbers are ignored for unshipped orders.

**Naming trap:** `estimateDelivery()` returns `earliest` and `promised`, but that `promised` is the **latest expected delivery** (slow end of transit), not the customer's promise. `parseOrder` renames them to `expectedEarliest` / `expectedLatest` and sets the real `promised` from `promisedDate(orderDate)`.

**ZIP lookup:** `data/zip-coords.js` defines `window.ZIP_COORDS` (ZIP to `[lat, lon]`). `locateZip` falls back to the average location of the 3-digit prefix (built lazily by `buildZip3Centers`) and marks the order `approximateLocation`, shown as "(approx.)".

### Where to make common changes

- **A table column:** add an entry to `COLUMNS` (key, label, `sortValue`) and a matching `case` in `cellContent`. Recheck the 1024 px fit.
- **A summary filter:** add a predicate to `FILTERS`, a tooltip to `FILTER_HINTS`, and a `statBox(...)` call in `renderSummary`.
- **A CSV column:** add it to `REQUIRED_COLUMNS` and read it with `get("<name>")` in `parseOrder`; update the README's CSV table.
- **Transit or promise rules:** the constants at the top of `js/transit.js`.
- **Which weather counts, timeout, concurrency:** the constants at the top of `js/weather.js` (`SEVERE_LEVELS`, `EMERGENCY_EVENTS`, `SNOW_LIMIT_INCHES`).
- **Which places/days are checked:** `weatherChecks` in `js/app.js`. Unshipped processing time: `UNSHIPPED_PROCESSING_DAYS`.
- **Delay notice wording:** `DEFAULT_SUBJECT`, `DEFAULT_BODY`, `delayUpdate`, `reasonText`, `carrierSection` in `js/notify.js`. A new placeholder needs an entry in `fillTemplate` and in `PLACEHOLDERS`.

## Business rules (in `js/transit.js`)

These are the user's decisions. Don't change them without asking.

- **Promised** = order date + `PROMISE_BUSINESS_DAYS` (7) business days, the same for every service level. Processing doesn't prioritize faster services.
- **Expected** = ship date + transit, shown as a window: earliest = fewest transit days, latest = most. Air uses `AIR_SERVICES` (fixed days, so a single date). Ground uses `GROUND_ZONES`: the zone comes from straight-line miles between ZIP centroids, and each zone's mileage limit is inclusive (exactly 150 mi is zone 2).
- **Processing** = business days from the order date to the ship date, not counting the order day. Label it "business days" in the UI.
- Business days skip weekends and six UPS holidays (`upsHolidays`), with weekend-observed shifts. A weekend or holiday order/pickup counts from the next business day.
- Ground is invalid to/from Hawaii and between Alaska and the mainland; Ground within Alaska is fine.
- Flags: **Late** if the earliest expected date is after Promised; **At risk** if only the latest is. Days late are business days.
- **Not shipped** (blank `ship_date`): assume 1 business day of processing from the order date; if that's already past, the next business day from today.
- **Weather** (user's spec): checked only for orders not delivered. Destination on each Expected-window day from today, Saturdays included and Sundays skipped (UPS runs Saturdays; the transit math still counts Mon–Fri, the user's option "a"). Origin on the ship day only for unshipped orders. A day counts if an NWS alert rated Severe or Extreme, or an emergency alert of any rating, is in effect that day, or more than 8 inches of snow is forecast that day (compared at 0.1 in.). Rain alone never counts. Likely-delay weather = **+1 delivery day** (one per order, however many bad days) via `nextDeliveryDay` in transit.js: Saturdays count, Sundays and UPS holidays don't, so Fri slips to Sat and Sat to Mon. An on-track order is flagged "At risk · weather" only if that day is after Promised; otherwise the weather is shown in gray with "+1 day: …, still on time". Weather never changes the displayed dates or a date flag. Lookup failures must never block the page: the order shows "weather unknown" and isn't flagged.

## Data

- Sample customers are made up: emails must stay on `example.com` (reserved, so a draft can't reach a real person) and tracking numbers on the fake `1ZTEST0103` + 8-digit order number pattern, blank for unshipped orders (the refresh script keeps this in step).
- `data/sample_orders.csv` is made-up data whose dates are set by `tools/refresh_sample_dates.py` relative to a day (currently 2026-10-28): 15 not shipped, 20 in transit, 15 delivered. Its dates produce exactly 4 date-flagged orders (ORD-20498 late; ORD-20488, ORD-20513, ORD-20525 at risk), all in transit. Live weather can flag more and varies by day, so check `timingRisk` when verifying this list. If you change the data, the groups in the script, or the rules, recheck it and update the README table.
- `data/zip-coords.js` is generated. Don't edit it by hand; rebuild it (see Commands). The source file comes from census.gov (URL in the README); keep the raw download out of the repo.

## UI conventions

- Column order: Order, Product, Value, Route, Service, Ship date, Promised, **Expected last** (the user's choice: the risk flags and weather alerts sit under it, next to the promise).
- Laptop: a table that must fit at 1024 px without sideways scrolling; Promised and Expected are pinned right when narrower. At 720 px and below: one card per order.
- The summary boxes (Need attention, Orders, Ground, Air) are the filters; there is no checkbox.
- Colors are CSS variables on `:root` with a dark-mode set; keep both in sync.

## Testing changes

- Serve the folder (see Commands, or `preview_start` with the `static` config) and load it in the browser pane; the pane can't run scripts from `file://`.
- The browser caches `styles.css` and `js/*.js`: `fetch(file, {cache: "reload"})` each changed file, then reload.
- Upload by setting `#file-input.files` from a `DataTransfer` and dispatching `change`; wait for the page's `load` first.
- Check the sample file (50 orders, 4 date-flagged), a deliberately broken CSV, and widths 1024 px and phone. Run click sequences one after another, not in parallel.
- **Weather tests:** alerts change daily, so find today's test ZIP first. List active alerts with `curl -H "User-Agent: delivery-risk-checker" "https://api.weather.gov/alerts/active?severity=Extreme,Severe"`, prefer a zone-wide one (Winter Storm, High Wind, Coastal Flood) over a narrow flood polygon, and confirm with `/alerts/active?point=<lat>,<lon>` using the ZIP's coordinates from `data/zip-coords.js`.
- Load the page as `/?today=2026-10-28` (or the sample's current day) so order groups are repeatable.
- Heavy snow (> 8 in.) is rare, so test the snow and emergency rules with fake data: wrap `window.fetch` to answer `/points/<lat>,<lon>` with a fake `forecastGridData` URL, that URL with `snowfallAmount.values`, and `/alerts/active?point=` with features carrying `event`, `severity`, `onset`, `ends`. Include boundary cases (exactly 8 in., a Sunday, a Moderate advisory, an alert outside the day).
- **Delay notice tests:** never let a `mailto:` link navigate (it opens the user's real email app): add a capturing `click` listener that calls `preventDefault()` on `a[href^="mailto:"]` before clicking, and read the draft from the link's URL instead. Capture the CSV by temporarily overriding `HTMLAnchorElement.prototype.click` for links with `download`, so no file is saved. Copy-to-clipboard needs a real user click, so a scripted click reports "Couldn't copy" (expected). Remove `drc-notified` and `drc-notify-template` from `localStorage` after testing.
- Simulate failures the same way: reject with a `TypeError` (no connection), resolve a `Response` with status 503/500, or never resolve (times out after 10 s). Match the exact `<lat.toFixed(4)>,<lon.toFixed(4)>` string, use a ZIP not yet in `weatherCache`, copy request logs (`.slice()`) before reusing them, and **reload the page afterwards** so fake answers don't stay cached.
