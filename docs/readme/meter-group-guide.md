# Meter Group Guide

This guide explains the three meter group types available when creating a meter group in Operator → Meter Setting.

---

## Parent-Child (Auto Calculation)

- **What it is:** One meter is designated as the **parent**; one or more other meters are **children**.
- **How billing works:** All usages come from CNYIoT. The system computes **shared usage** = **parent usage − sum of child usages** (not below zero). That **shared** kWh is then split among children per your sharing mode (Equal Split / By Usage / By Percentage). Each child’s **final** usage is **own child usage + their share of shared usage** (see `docs/meter-billing-spec.md`).
- **Use case:** When you have one main meter (e.g. whole unit) and sub-meters per room, and the “gap” between main and sub-meters should be allocated automatically.
- **Sample example:** Parent **600 kWh**; children **120 + 180 + 150 = 450 kWh**. **Shared usage** = **600 − 450 = 150 kWh**. Only this **150 kWh** is split across the three children (not the full **600**). Each child also has their own **120 / 180 / 150** kWh from their meter before sharing rules add their portion of the **150**.

---

## Parent-Child (Manual Entry)

- **What it is:** One meter is the **parent**; one or more others are **children**.
- **How billing works:** Usages still come from CNYIoT. **Manual** means the **shared pool** uses **full parent usage** — the system **does not** subtract children’s kWh first (`sharedUsage = parentUsage`). When invoicing, you align to the **TNB bill** (operator enters the amount); shared cost uses **TNB unit cost**, while each child’s own kWh was already covered at **selling rate** (hybrid rule in `docs/meter-billing-spec.md`).
- **Use case:** When you bill against the **official TNB total** and must not reduce the parent total by sub-meters before splitting.
- **Sample example:** Parent **500 kWh** for the month. **Manual** pool = **500 kWh** (not **500 − sum(children)**). You enter e.g. **RM 350** TNB for that period; that amount is split across children per sharing mode at TNB per-kWh, on top of each child’s own prepaid/postpaid treatment already at selling rate.

---

## Brother Group (Equal Peers)

- **What it is:** Multiple meters are linked as **peers** (no parent). They form one group.
- **How billing works:** Each peer’s usage is read from CNYIoT; **total group usage** is the sum of peers. When you split a **money amount** (e.g. one invoice line), **Equal Split** divides it evenly; **By Usage** uses each peer’s kWh share of **total group usage**; **By Percentage** uses the percentages you configured.
- **Use case:** When several meters should share one bill with a defined split (e.g. common area meters split by percentage or equally).
- **Sample example:** Three peers: **80 + 120 + 100 = 300 kWh** total. One amount to split: **RM 900**. **Equal Split** → **RM 300** each. **By Usage** → **80/300 / 120/300 / 100/300** of **RM 900** → **RM 240 / RM 360 / RM 300**. **By Percentage** (fixed shares, e.g. **40% / 35% / 25%**) → **RM 360 / RM 315 / RM 225** (must total 100%).

---

## Sharing modes

When creating or editing a group, you can choose how costs are split:

- **Equal Split** — divide the total cost equally among all meters in the group.
- **By Usage** — split according to each meter’s usage.
- **By Percentage** — assign a percentage of the total cost to each meter.

**Sample examples** (splitting one **RM 600** charge across **three** meters):

- **Equal Split**: **RM 200** each.
- **By Usage** (same period): usages **100 + 200 + 100 = 400 kWh** → shares **100/400, 200/400, 100/400** → **RM 150 / RM 300 / RM 150**.
- **By Percentage**: you assign **40% / 35% / 25%** → **RM 240 / RM 210 / RM 150** (must total **100%**).

*Note: For **Parent-Child (Auto)**, the amount you split is the **shared** kWh (and its cost) after **parent − children**, not the parent total alone — see the first section.*

---

*Generated from docs/readme. For more on Meter Setting and CNYIoT integration, see docs/readme/index (CNYIoT API wrapper, Meter Setting page).*
