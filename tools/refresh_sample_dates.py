"""Move the sample orders' dates so they're current as of a given day.

The app sorts orders by how they stand on "today": likely delivered, in transit,
or not shipped yet (blank ship_date). Fixed sample dates go stale within days,
so this rewrites order_date and ship_date in data/sample_orders.csv to give:

- 15 orders not shipped yet (ordered today up to 3 business days ago)
- 20 orders in transit (shipped today or the business day before)
- 15 orders likely delivered (shipped 8-11 business days ago)

Each order keeps its processing time (business days from order to ship), so the
four date-flagged orders stay flagged: ORD-20498 late; ORD-20488, ORD-20513 and
ORD-20525 at risk. ORD-20516 and ORD-20519 are ordered on a weekend.

Only weekends are skipped here, not UPS holidays: near a holiday, re-check the
flagged orders in the app.

Usage:
    python tools/refresh_sample_dates.py                      # as of today
    python tools/refresh_sample_dates.py --today 2026-10-28   # as of another day
"""

import argparse
import csv
from datetime import date, timedelta

PATH = "data/sample_orders.csv"

# Business days from order to ship for orders that have shipped.
PROCESSING = {
    "20481": 2, "20483": 3, "20484": 2, "20486": 5, "20487": 2, "20488": 4, "20490": 2,
    "20491": 4, "20492": 3, "20494": 3, "20495": 2, "20497": 2, "20498": 5, "20499": 3,
    "20501": 2, "20503": 3, "20504": 2, "20505": 1, "20506": 2, "20507": 3, "20509": 2,
    "20511": 2, "20512": 3, "20513": 3, "20515": 2, "20517": 2, "20520": 2, "20522": 3,
    "20523": 2, "20525": 4, "20526": 2, "20528": 3, "20529": 2,
}
WEEKEND_ORDERS = {"20516": 5, "20519": 6}  # ordered on the Saturday / Sunday before shipping

# Not shipped yet: business days since the order was placed (0 = today).
NOT_SHIPPED = {
    "20482": 0, "20485": 1, "20489": 0, "20493": 1, "20496": 2, "20500": 0, "20502": 1,
    "20508": 0, "20510": 1, "20514": 3, "20518": 0, "20521": 1, "20524": 0, "20527": 1,
    "20530": 2,
}
IN_TRANSIT = [
    "20481", "20483", "20484", "20486", "20487", "20488", "20490", "20491", "20492", "20494",
    "20495", "20497", "20498", "20499", "20501", "20503", "20513", "20516", "20519", "20525",
]
DELIVERED = [
    "20504", "20505", "20506", "20507", "20509", "20511", "20512", "20515", "20517", "20520",
    "20522", "20523", "20526", "20528", "20529",
]


def is_business_day(d):
    return d.weekday() < 5


def business_days_back(d, n):
    """The business day n business days before d (n = 0: d itself, or the one before if d is a weekend)."""
    while not is_business_day(d):
        d -= timedelta(days=1)
    while n > 0:
        d -= timedelta(days=1)
        if is_business_day(d):
            n -= 1
    return d


def weekend_day_before(d, weekday):
    """The last Saturday (5) or Sunday (6) before d."""
    d -= timedelta(days=1)
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def dates_for(num, today):
    """(order_date, ship_date or None) for one order number."""
    if num in NOT_SHIPPED:
        return business_days_back(today, NOT_SHIPPED[num]), None
    if num in IN_TRANSIT:
        ship = business_days_back(today, IN_TRANSIT.index(num) % 2)
    else:
        ship = business_days_back(today, 8 + DELIVERED.index(num) % 4)
    if num in WEEKEND_ORDERS:
        return weekend_day_before(ship, WEEKEND_ORDERS[num]), ship
    return business_days_back(ship, PROCESSING[num]), ship


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--today", type=date.fromisoformat, default=date.today())
    today = parser.parse_args().today

    with open(PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())

    counts = {"not shipped": 0, "in transit": 0, "delivered": 0}
    for row in rows:
        num = row["order_id"].split("-")[1]
        order_date, ship_date = dates_for(num, today)
        row["order_date"] = order_date.isoformat()
        row["ship_date"] = ship_date.isoformat() if ship_date else ""
        if "tracking_number" in row:
            # Made-up UPS-style number (UPS won't find it); only shipped orders have one.
            row["tracking_number"] = f"1ZTEST0103{int(num):08d}" if ship_date else ""
        counts["not shipped" if num in NOT_SHIPPED else "in transit" if num in IN_TRANSIT else "delivered"] += 1

    with open(PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Dates set as of {today}: {counts}")


if __name__ == "__main__":
    main()
