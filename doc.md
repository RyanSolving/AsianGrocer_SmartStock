# Smart Stock Management System

> **Project Key:** PJM | **Author:** Ryan Huynh | **Last Updated:** March 2026

## Overview

The **Smart Stock Management System** is an end-to-end data pipeline and analytics solution designed to help fruit store operations proactively manage stock levels, detect high-demand products, and reduce waste — powered by automated data ingestion, dbt transformations, and a Power BI operational dashboard.

---

## Problem Statement

Fruit store operations currently face two critical pain points:

- **Missed stock-outs** — Staff occasionally forget to check and restock certain fruits, especially newly introduced ones.
- **Demand misalignment** — Stock quantities are insufficient for high-demand (hot) products, leading to lost sales and customer dissatisfaction.

---

## Goals

| # | Goal |
|---|------|
| 1 | Never miss out-of-stock situations |
| 2 | Continuously track current stock levels |
| 3 | Detect and flag high-demand products in real time |

---

## Stakeholders

| Stakeholder | Goal | Wishes | Questions to Answer |
|---|---|---|---|
| **Stock Checker** | Never miss stock | Reminders to check if he forgot (especially new fruits) | Am I missing something? |
| **Store Owner** | Buy enough stock for operation | Detect high-demand products; reminders to restock and buy high-demand items | Which product should I buy more? Which product is lower priority? |
| **Fruit Section Staff** | Keep track of how much stock is left | Out-of-stock alerts for price adjustment, display planning, and waste management | Should I increase the price? Would it rot soon? If it rots, how much is lost? |

---

## Solution Architecture

The system leverages an automated ELT pipeline feeding into a Power BI operational dashboard.

```
Photo / Manual Input
        │
        ▼
  OCR / AI Extraction
  (Transcribe stock data from photos)
        │
        ▼
  Data Loader (Automated Ingestion)
  (Scheduled pipeline – daily 5PM run)
        │
        ▼
  Database (Staging Layer)
  (Raw stock records stored)
        │
        ▼
  dbt Transformations
  (Schema design, modelling, business logic)
        │
        ▼
  Power BI Dashboard
  (Operational visibility for all stakeholders)
```

---

## Pipeline Flow

1. **dbt Schema Design** — Define staging, intermediate, and mart models for stock data
2. **Automated Data Loader** — Schedule and run data ingestion (daily 5PM trigger)
3. **Transcribe & Load Database** — OCR/AI extraction from stock photos → structured records
4. **Power BI Dashboard** — Visualise stock levels, demand trends, and alerts

---

## Tech Stack

| Layer | Tool |
|---|---|
| Data Warehouse | Snowflake / Supabase |
| OCR / AI Extraction | OpenAI API (Vision) |
| Visualisation | Power BI |
| Project Management | Jira (PJM) |
| Version Control | GitHub |

---

## Key Dashboard Features

- 🟥 **Out-of-stock alerts** — Instant notification when a product drops below threshold
- 📈 **High-demand detection** — Identifies products with accelerating sales velocity
- 🗓️ **Restock reminders** — Scheduled nudges for stock checkers
- 💰 **Waste management view** — Tracks near-expiry stock value at risk
- 📊 **Price adjustment signals** — Recommends price increases when stock is critically low

---

---

## Project Status

| Milestone | Status |
|---|---|
| Stakeholder requirements | ✅ Done |
| Database schema design | ✅ Done |
| OCR / data loader pipeline | 🔄 In Progress |
| dbt model development | 🔄 In Progress |
| Power BI dashboard | 📋 Planned |

---

*Managed on [Jira – Tanhung_StockManagement (PJM)](https://ryanhuynh.atlassian.net/jira/software/projects/PJM/list)*
