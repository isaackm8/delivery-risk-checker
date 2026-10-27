# delivery-risk-checker

A prototype tool for spotting orders whose delivery is at risk from bad weather, so a merchant can act before the customer notices.

## Status

Version 1 estimates a delivery date for each order. Weather risk scoring comes next.

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

There's nothing to install and no internet connection needed. The file is read in your browser and never uploaded.

## CSV format

| Column | Example | Notes |
| --- | --- | --- |
| `order_id` | `ORD-20481` | |
| `order_date` | `2026-10-15` | When the customer placed the order. `10/15/2026` also works |
| `order_value` | `64.00` | `$` and thousands separators are fine |
| `product_name` | `Pour-Over Coffee Kit` | |
| `product_description` | `Ceramic dripper with glass carafe` | |
| `origin_zip` | `43228` | Leading zeros dropped by Excel (`2139`) and ZIP+4 (`43228-1234`) are handled |
| `destination_zip` | `02139` | Same as above |
| `ups_service_level` | `UPS Ground` | Ground, 3 Day Select, 2nd Day Air, Next Day Air Saver or Next Day Air |
| `ship_date` | `2026-10-19` | When the label was created and UPS picked it up. `10/19/2026` also works |

Rows with a problem (unknown service level, bad ZIP or date, Ground to or from Hawaii, a ship date before the order date) are skipped and listed with the reason.

## Promised vs. expected

```
Order placed ──(+7 business days)──────────────────────▶ PROMISED
     │
     └──(processing)──▶ SHIP DATE ──(UPS transit)──────▶ EXPECTED
```

- **Promised** is the date the customer is told at checkout: **order date + 7 business days**, the slow end of a 5–7 day cushion for processing plus shipping. It's the same for every service level, because processing doesn't prioritize faster services. An order placed on a weekend or holiday counts from the next business day. It never changes.
- **Processing** is the business days from the order to the ship date (label created, picked up by UPS), shown under each ship date. The order day itself isn't counted, so an order placed Thursday and shipped the following Monday took 2 business days (Friday and Monday).
- **Expected** is when the order will most likely arrive, as a window (e.g. Oct 21–22): **ship date + UPS transit time** (see below). Weather will push it later in a future version.

Each order whose expected window runs past its promised date is flagged:

| Flag | Meaning |
| --- | --- |
| **At risk · N days** | The latest expected date is after the promise, but the earliest could still make it |
| **Late · N days** | Even the earliest expected date is after the promise |

*N* is the number of business days past the promise. Hover over a flag to see why, e.g. "4 business days processing + 3–4 business days UPS Ground transit runs past the 7-business-day promise." Right now, flags come from slow processing, long routes, or both. The summary boxes at the top double as filters: click **Need attention**, **Ground** or **Air** to show only those orders, and click the same box again (or **Orders**) to show all of them. The note under the boxes says how many orders are showing. Sorting by Expected puts late orders first.

The sample file's order dates are made up (most orders ship 1–3 business days after the order) and include four orders that need attention:

| Order | Processing | Transit | Flag |
| --- | --- | --- | --- |
| ORD-20498 | 5 days | Ground zone 5, 3–4 days | Late · 2 days |
| ORD-20488 | 4 days | Ground zone 5, 3–4 days | At risk · 1 day |
| ORD-20525 | 4 days | Ground zone 5, 3–4 days | At risk · 1 day |
| ORD-20513 | 3 days | Ground zone 6, 4–5 days | At risk · 1 day |

ORD-20486 also took 5 days to process, but 2nd Day Air still meets its promise. ORD-20516 and ORD-20519 were ordered on a weekend.

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
| `data/zip-coords.js` | Latitude and longitude for 33,791 ZIP codes |
| `data/sample_orders.csv` | 50 made-up orders for trying the app |
| `tools/build_zip_coords.py` | Rebuilds `data/zip-coords.js` from a newer Census file |

ZIP locations come from the US Census Bureau's [2025 ZCTA Gazetteer file](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip). ZIPs that aren't in it, like some PO-box-only ZIPs, use the average location of their 3-digit prefix and are marked "approx." in the results. To rebuild:

```
python tools/build_zip_coords.py 2025_Gaz_zcta_national.txt data/zip-coords.js
```
