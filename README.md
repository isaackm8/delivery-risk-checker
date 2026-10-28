# delivery-risk-checker

A prototype tool for spotting orders whose delivery is at risk from bad weather, so a merchant can act before the customer notices.

## Status

Prototype. It estimates a delivery date for each order, flags orders whose dates or likely weather miss the promise, and prepares delay notices so the merchant can warn customers and point them to UPS to reroute or hold the package.

## Problem

A merchant promises a delivery date at checkout, and bad weather makes some orders late. Each late order costs the merchant money and goodwill:

- **Refunds** and shipping credits
- **Support tickets**, especially "where is my order?" (WISMO) contacts
- **Lost repeat purchases** from customers who don't come back

The question this project starts from: what does a late order actually cost, and how much of that cost can be avoided?

## Intended user

A small online merchant who ships a few hundred orders a week. They don't have a logistics team, and they find out about weather delays the same way their customers do: after the fact.

## Hypothesis

If the merchant knows which orders are at risk before the customer does, they can warn the customer or upgrade shipping, and fewer late orders turn into complaints.

## How we'll measure success

| Metric | What it tells us |
| --- | --- |
| Share of at-risk orders flagged ahead of time | Whether the tool catches delays before they happen |
| Late-delivery rate | Whether upgrades and interventions reduce lateness |
| "Where is my order?" calls | Whether proactive warnings cut support load |
| NPS | Whether customers feel better treated, even when an order is late |
| Cost per late order | Whether the combined savings (refunds, tickets, churn) are real |

## Out of scope for the first version

- Real carrier data
- Live tracking
- Payments

## How to run

1. Download or clone this repository.
2. Double-click `index.html` to open it in your browser.
3. Drop a CSV onto the page, or click **choose a file**. Try `data/sample_orders.csv`.

There's nothing to install. The file is read in your browser and never uploaded. The only network traffic is the weather check: approximate locations (ZIP code center points, not addresses) of destinations, and of origins for unshipped orders, are sent to the National Weather Service.

The app judges each order as of **today** (your computer's date). To see it as of another day, add `?today=YYYY-MM-DD` to the page address, e.g. `index.html?today=2026-10-28`. Without an internet connection everything else still works, and the page says weather couldn't be checked.

## CSV format

| Column | Example | Notes |
| --- | --- | --- |
| `order_id` | `ORD-20481` | |
| `customer_name` | `Ava Thompson` | Optional; used to greet the customer in delay notices |
| `customer_email` | `ava.thompson@example.com` | Optional; needed to send a delay notice |
| `order_date` | `2026-10-15` | When the customer placed the order. `10/15/2026` also works |
| `order_value` | `64.00` | `$` and thousands separators are fine |
| `product_name` | `Pour-Over Coffee Kit` | |
| `product_description` | `Ceramic dripper with glass carafe` | |
| `origin_zip` | `43228` | Leading zeros dropped by Excel (`2139`) and ZIP+4 (`43228-1234`) are handled |
| `destination_zip` | `02139` | Same as above |
| `ups_service_level` | `UPS Ground` | Ground, 3 Day Select, 2nd Day Air, Next Day Air Saver or Next Day Air |
| `ship_date` | `2026-10-19` | When the label was created and UPS picked it up. `10/19/2026` also works. **Leave blank if not shipped yet** |
| `tracking_number` | `1Z999AA10123456784` | Optional; the UPS tracking number, so the customer can reroute or hold the package |

Rows with a problem (unknown service level, bad ZIP or date, Ground to or from Hawaii, a ship date before the order date) are skipped and listed with the reason.

For an order that hasn't shipped, the app assumes **1 business day of processing**: it ships the business day after the order, or on the next shipping day from today if that's already passed. The table shows "Not shipped" and the estimated ship date.

## Promised vs. expected

```
Order placed ──(+7 business days)──────────────────────▶ PROMISED
     │
     └──(processing)──▶ SHIP DATE ──(UPS transit)──────▶ EXPECTED
```

- **Promised** is the date the customer is told at checkout: **order date + 7 business days**, the slow end of a 5–7 day cushion for processing plus shipping. It's the same for every service level, because processing doesn't prioritize faster services. An order placed on a weekend or holiday counts from the next business day. It never changes.
- **Processing** is the business days from the order to the ship date (label created, picked up by UPS), shown under each ship date. The order day itself isn't counted, so an order placed Thursday and shipped the following Monday took 2 business days (Friday and Monday).
- **Expected** is when the order will most likely arrive, as a window (e.g. Oct 21–22): **ship date + UPS transit time** (see below).

Each order whose expected window runs past its promised date is flagged:

| Flag | Meaning |
| --- | --- |
| **At risk · N days** | The latest expected date is after the promise, but the earliest could still make it |
| **Late · N days** | Even the earliest expected date is after the promise |
| **At risk · weather** | The dates are fine, but a likely weather delay of one day would push delivery past the promise (see below) |

*N* is the number of business days past the promise. Hover over a flag to see why, e.g. "4 business days processing + 3–4 business days UPS Ground transit runs past the 7-business-day promise." Date flags come from slow processing, long routes, or both.

The summary boxes at the top double as filters: click **Need attention**, **Ground** or **Air** to show only those orders, and click the same box again (or **Orders**) to show all of them. The note under the boxes says how many orders are showing. Sorting by Expected puts late orders first.

### Weather

We don't know a package's route, so the app checks the two ends, on the days that matter, using the free [National Weather Service API](https://www.weather.gov/documentation/services-web-api):

| Order (as of today) | How the app tells | What's checked |
| --- | --- | --- |
| **Likely delivered** | Its Expected window has passed | Nothing; it shows "likely delivered" |
| **In transit** | Shipped, Expected window not over | Destination, on each remaining day of the Expected window |
| **Not shipped yet** | Blank `ship_date` | Origin on the estimated ship day, and destination on each day of the Expected window |

UPS works Saturdays but not Sundays, so Saturdays inside a window are checked and Sundays aren't. (The transit math itself still counts Monday to Friday.)

A day counts as a likely delay at a place if any of these is true:

- an NWS alert rated **Severe** or **Extreme** is in effect that day (e.g. Winter Storm Warning, Flood Warning or Watch, High Wind Warning), including alerts issued now for a later day;
- an **emergency** alert is in effect that day, whatever its rating (Civil Emergency Message, Local Area Emergency, Civil Danger Warning, Evacuation Immediate, Shelter In Place, Nuclear Power Plant, Hazardous Materials);
- **more than 8 inches of snow** is forecast that day, from the NWS forecast grid (about 7 days ahead).

Rain alone never counts, only flood alerts. Minor and Moderate alerts (advisories, statements) are ignored.

- Likely-delay weather counts as **one extra delivery day** after the latest Expected date, however many bad days there are. UPS delivers Saturdays, so a Friday delivery slips to Saturday; Sundays and UPS holidays are skipped, so a Saturday delivery slips to Monday.
- If that day lands **after the promise**, an on-track order becomes **At risk · weather**, shown in orange: e.g. expected Oct 29–30, promised Fri Oct 30, storm Thursday: "+1 day: Sat, Oct 31, past the promise".
- If it still lands **on or before the promise**, the order isn't flagged. The weather is listed in gray with "+1 day: …, still on time", so the merchant can still see it.
- An order already At risk or Late by its dates keeps that flag, with the weather listed under it. Under the Expected date the app lists what it found, where and when, e.g. "Origin: Civil Emergency Message (Thu)" or "Destination: 9 in. snow (Sat)"; hover for details. The Expected dates shown don't change.
- A delivery day beyond the snow forecast shows "no snow forecast yet from …". Alerts are still checked.
- Each ZIP is looked up once per page session (3 requests: alerts, location, forecast), a few ZIPs at a time, and orders sharing a ZIP share the answer. Reload the page to check fresh.
- If a lookup fails (no connection, a server error, or no answer within 10 seconds), those orders show "weather unknown", aren't flagged for weather, and a notice offers **Retry**, which asks only for the ZIPs that failed.
- Limits: it uses the ZIP's center point, so a narrow alert area (e.g. a flood warning along one river) can miss it. "Delivered" is an assumption from the dates, not tracking. A governor's state-of-emergency declaration isn't an NWS alert, so it isn't seen.

The sample file's dates are made up and set relative to a day (see Refreshing the sample dates): 15 orders not shipped yet, 20 in transit and 15 likely delivered. Four orders' dates need attention; weather can add more, depending on the day you load it:

| Order | Processing | Transit | Flag |
| --- | --- | --- | --- |
| ORD-20498 | 5 days | Ground zone 5, 3–4 days | Late · 2 days |
| ORD-20488 | 4 days | Ground zone 5, 3–4 days | At risk · 1 day |
| ORD-20525 | 4 days | Ground zone 5, 3–4 days | At risk · 1 day |
| ORD-20513 | 3 days | Ground zone 6, 4–5 days | At risk · 1 day |

ORD-20486 also took 5 days to process, but 2nd Day Air still meets its promise. ORD-20516 and ORD-20519 were ordered on a weekend.

## Notifying customers

When an order may be delayed, the merchant can warn the customer before they notice, and give them the chance to reroute or hold the package.

1. **Select orders.** Tick the box next to each order, or click **Select all that need attention**. Likely-delivered orders can't be selected.
2. Click **Notify customers…**. A panel shows the message, a live preview, and the list of recipients. **Click a customer's name** to see exactly what their email says; their row is highlighted.
3. **Edit the message** if you like. These are filled in for each order: `{first_name}`, `{order_id}`, `{product}`, `{promised_date}`, `{delay_update}`, `{new_date}`, `{reason}`, `{carrier_section}`, `{signature}`. Your edits and signature are remembered in this browser when you click **Done**; **Cancel**, the **×** or the Esc key closes the panel and undoes this time's edits, and **Reset message to default** goes back to the original wording.
4. **Send.** Click **Send all emails** to mark every customer listed as **Notified**. In this prototype that's simulated: no email actually leaves the page. To send one for real, **Open email draft** opens it in your own email app (Outlook, Gmail, etc.); opening a draft shows "Draft opened" but doesn't mark the order notified. Or use **Copy all messages**, or **Download CSV** (order, name, email, tracking number, subject, message) for an email or text-message tool.

What each customer is told depends on their order:

| Situation | `{delay_update}` says |
| --- | --- |
| Flagged At risk or Late | The reason (weather near the delivery address or warehouse, or "running behind schedule") and the new date |
| Weather, but still within the promise | It could arrive a day later than planned, still within the promised date |
| Nothing predicted | It's still on schedule, and you'll let them know if that changes |

| Order | `{carrier_section}` says |
| --- | --- |
| Shipped, with a tracking number | A link to the UPS tracking page, where the customer can follow it, have it delivered to another address, or hold it at a UPS Access Point (through UPS My Choice; UPS may charge for some options) |
| Shipped, no tracking number | The same options, using the tracking number from their shipping email |
| Not shipped yet | You'll send tracking when it ships, and how they'll be able to reroute or hold it then |

Orders without a usable email are listed and skipped. **Send all emails** marks the order **Notified** with the date, shown under the order number. That's remembered in this browser only, so another computer or person won't see it.

The sample file's customers are made up: their emails use `example.com`, a domain reserved for examples, so drafts can't reach anyone, and the tracking numbers (`1ZTEST…`) aren't real, so UPS won't find them.

## Refreshing the sample dates

Fixed dates go stale within days: by next week, every sample order would look delivered. To move them so they're current again:

```
python tools/refresh_sample_dates.py                      # as of today
python tools/refresh_sample_dates.py --today 2026-10-28   # as of another day
```

Each order keeps its processing time, so the four date-flagged orders stay flagged. The script skips weekends but not UPS holidays; near a holiday, re-check the flags in the app.

## How the estimate works

**Air services** take a fixed number of business days: Next Day Air and Next Day Air Saver 1, 2nd Day Air 2, 3 Day Select 3.

**UPS Ground** depends on the straight-line distance between the origin and destination ZIP codes:

| Zone | Miles | Business days |
| --- | --- | --- |
| 2 | 0–150 | 1–2 |
| 3 | 151–300 | 1–2 |
| 4 | 301–600 | 2–3 |
| 5 | 601–1,000 | 3–4 |
| 6 | 1,001–1,400 | 4–5 |
| 7 | 1,401–1,800 | 5–6 |
| 8 | 1,801+ | 5–7 |

Ground isn't available to or from Hawaii, or between Alaska and the mainland. Ground within Alaska is allowed.

**Dates:** transit starts the business day after pickup. Weekends and major UPS holidays are skipped: New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and Christmas, moved to Friday or Monday when they fall on a weekend. The **expected** window runs from the fewest to the most transit days.

These are rules of thumb, not UPS's official transit times.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css` | The page and its look (laptop table, phone cards, light and dark mode) |
| `js/app.js` | Upload, row checks, late / at-risk flags, summary and results table |
| `js/transit.js` | Delivery rules: the 7-day promise, service levels, zones, distance, holidays |
| `js/csv.js` | Reads CSV text into rows |
| `js/notify.js` | Delay notices: message building, the notify panel, email drafts, copy, CSV export, "notified" memory |
| `js/weather.js` | Weather lookups from the National Weather Service (alerts, emergencies, snow forecast by day), with a per-ZIP cache |
| `data/zip-coords.js` | Latitude and longitude for 33,791 ZIP codes |
| `data/sample_orders.csv` | 50 made-up orders for trying the app |
| `tools/build_zip_coords.py` | Rebuilds `data/zip-coords.js` from a newer Census file |
| `tools/refresh_sample_dates.py` | Moves the sample orders' dates so they're current as of a given day |

ZIP locations come from the US Census Bureau's [2025 ZCTA Gazetteer file](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip). ZIPs that aren't in it, like some PO-box-only ZIPs, use the average location of their 3-digit prefix and are marked "approx." in the results. To rebuild:

```
python tools/build_zip_coords.py 2025_Gaz_zcta_national.txt data/zip-coords.js
```
