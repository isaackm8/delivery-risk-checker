# delivery-risk-checker

A prototype tool for spotting orders whose delivery is at risk from bad weather, so a merchant can act before the customer notices.

## Status

Early prototype. No code yet.

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

## Getting started

Setup instructions will be added once the first version exists.
