# Stocklist Photo Parser Web App - Technical Specification

> **Project:** Smart Stock Management System (PJM) | **Component:** OCR Data Ingestion Web App | **Version:** 1.0 | **Date:** April 2024 | **Author:** BLACKBOXAI

## 1. Overview

**Purpose:** A simple web application for ingesting stocklist photos (printed/handwritten tables) into structured JSON data via AI OCR (OpenAI Vision), enabling human review/editing, and loading to Snowflake. This implements the "OCR / AI Extraction" + "Data Loader" steps in the pipeline from `doc.md`.

**MVP Workflow:**
1. Drag-drop photo upload
2. AI OCR → structured table (parse products, quantities, locations)
3. Human edit/review (editable table)
4. Validate → Load to Snowflake staging table
5. Success feedback + export CSV/JSON backup

**Future Features:**
- Multi-photo batch processing
- Export as stocklist photo layout (PDF/image)
- Auto-normalization from product catalogue
- Confidence-based review queue

**App Layouts (3 Main Pages):**
1. **Data Entry (Pipeline)**: Upload photo → OCR → Edit → Snowflake load (MVP focus).
2. **Check Stock**: Manual stock input/checker mode (future: real-time stock view/alerts).
3. **Dashboard**: Analytics overview (future: Power BI embed post-pipeline).

**Users:** Stock checker, Store owner (role-based via auth).

**Authentication:** Required for all pages.
- Provider: Clerk (Vercel-native, easy RBAC).
- Roles: `checker` (data entry/check stock), `owner` (all + dashboard).
- Flows: Email/password or Google; protected routes.

## 2. Goals & Success Metrics

| Goal | Metric |
|------|--------|
| 95% OCR accuracy on clear photos | Human edit time &lt; 2min/photo |
| Zero data loss to Snowflake | 100% successful loads |
| Simple UX for non-tech users | Onboard in &lt;1min |
| Scalable to 50+ photos/day | &lt;10s AI processing/photo |

## 3. Data Model

### Input: Stocklist Photo
- JPEG/PNG, ~1-5MB
- Format: 2-column table (Product | Weight(lbs) | Location header)
- Date in top-right (e.g., "DATE : 26/3/26")

### Output: Structured JSON (per photo)
```json
{
  "photo_id": "uuid-or-filename",
  "upload_date": "2024-04-01T12:00:00Z",
  "stock_date": "2026-03-26",  // Extracted/parsed from photo
  "photo_url": "https://vercel-blob/photo.jpg",  // Optional cloud storage
  "total_items": 25,
  "confidence_overall": "high|medium|low",
  "items": [
    {
      "product_raw": "Granny Smith",  // Exact handwritten text
      "product_name": "Granny Smith Apple",  // Normalized from catalogue
      "category": "Apples|Pears|Citrus|Grapes|Stone Fruits|Berries|Coconuts|Exotic|Asian|Mangos|Bananas|Melons|Pineapple|Kiwi|Avocado|Other",
      "size_variant": "Large|Small|null",
      "unit": "kg|box|punnet|pack|null",
      "quantity_raw": "12",  // Exact text
      "quantity": 12,  // Parsed integer
      "quantity_conflict_flag": false,  // e.g., "12?" or crossed out
      "location": "Inside Coolroom|Outside Coolroom|All Year Section|Seasonal|Asian|Stonefruit|Unknown",
      "row_position": "left|right|single",
      "confidence": "high|medium|low",
      "notes": "Handwritten, slightly smudged|null"
    }
  ]
}
```

**Snowflake Staging Table Schema** (recommended):
```sql
CREATE TABLE stock_photos_raw (
  photo_id VARCHAR,
  upload_date TIMESTAMP,
  stock_date DATE,
  photo_url VARCHAR,
  total_items INT,
  confidence_overall VARCHAR,
  item_data VARIANT,  // JSON array of items
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 4. Features (MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Photo Upload** | Drag-drop or file picker (JPEG/PNG), preview, auto-date extract | MVP |
| **AI OCR Parsing** | OpenAI GPT-4o-vision: Detect table, extract text, classify/structure per schema | MVP |
| **Editable Table** | React table: Edit cells inline, add/remove rows, validate (Zod) | MVP |
| **Review Workflow** | Confidence highlights (red=low), bulk approve/edit, undo | MVP |
| **Snowflake Load** | API inserts JSON to staging table; error handling/retries | MVP |
| **Export** | Download CSV/JSON; success confirmation | MVP |
| **History** | List past uploads (photo thumbnail, status, edit link) | Post-MVP |

## 5. Architecture

```
[Browser] --upload--> [Next.js Vercel]
                    |
                    |-- [OpenAI Vision API] --> Structured JSON
                    |
                    |-- [Editable Table UI] <-- Human Review
                    |
                    +--> [Snowflake SDK] --> staging table
```

**Data Flow:**
1. `/api/upload` → Store photo (Vercel Blob/ temp), call OpenAI Vision
2. Vision prompt: "Extract stock table as JSON per schema. Handle handwriting."
3. `/` → Display editable table (use react-table + Hook Form)
4. `/api/save` → Validate → Snowflake insert
5. Power BI connects to Snowflake for transforms/dashboards (per doc.md)

**Security:** Clerk auth (JWT), role guards. API keys server-side. Snowflake creds via Vercel env vars.

## 6. UI/UX Wireframes (Text)

### Layout: Sidebar Nav (Minimalist)
```
┌─ Nav ─┐ ┌─ Content ──────────────────────┐
│ 📁 Data Entry │ Home/Dashboard (Data Entry)
│ ✅ Check Stock│ ```
│ 📊 Dashboard  │ ┌─────────────────────────┐
└───────────────┘ │ Upload Stocklist Photo  │
                  │ [Drag-drop] [History ▼] │
                  │ 📷 Preview             │
                  │ [AI Parse] [Save]       │
                  └─────────────────────────┘
```
│ 📁 Data Entry │ Home/Dashboard (Data Entry)

### Parsed Table View
```
┌────────────── Editable Stock Table ──────────────┐
│ Date: 2026-03-26 [📅]  Confidence: High [⚠️]     │
├─ Product ─────┼─ Qty ───┼─ Unit ─┼─ Location ─────┼─ Confidence ─┤
│ Granny Smith  │ 12      │ kg    │ Inside Coolroom │ 🟢 High     │ ✏️
│ Red Seedless  │ 14      │ box   │ All Year        │ 🟡 Medium   │ ✏️
└──────────────────────────────────────────────────┘
[← Prev Photo] [Validate & Save to Snowflake] [Export CSV]
```

**UI Design System:**
- **Style:** Minimalist (max whitespace, simple typography).
- **Colors:** White (#FFFFFF) bg, Black (#000000) text, Blue (#0070F3) primary/accents, Red (#EF4444) alerts/errors.
- Tailwind + shadcn/ui components.
- Responsive/mobile-first.
- Protected routes (auth gate).

## 7. Tech Stack (Recommended for Vercel)

| Layer | Tech | Why |
|-------|------|-----|
| Framework | Next.js 14 (App Router) | Vercel-optimized, API routes, SSR, auth middleware |
| UI | Tailwind CSS + shadcn/ui + react-table | Simple, customizable table |
| Forms/Table | React Hook Form + Zod | Validation, editable cells |
| AI OCR | OpenAI SDK (gpt-4o-vision) | Handles handwriting/tables best |
| Storage | Vercel Blob (photos) | Serverless, auto-scaling |
| DB | Snowflake SDK (@snowflake/snowflake-sdk) | Direct inserts |
| Deployment | Vercel Pro | Auto-deploys, env vars, scale |
| Other | TypeScript, zustand (state) | Type safety, simple state |

**No backend server needed** (all serverless APIs).

## 8. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/parse-photo` | POST | {photo: File} → JSON structured data |
| `/api/history` | GET | List past uploads |
| `/api/save-to-snowflake` | POST | {jsonData} → Insert to staging |
| `/api/export-csv` | POST | {jsonData} → CSV download |

## 9. Deployment (Vercel)

1. `git push` → Auto-deploy
2. Env vars: `OPENAI_API_KEY`, `SNOWFLAKE_ACCOUNT|USER|PASSWORD|WAREHOUSE|DB|SCHEMA`
3. Custom domain optional
4. Blob storage: Vercel dashboard setup

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Poor handwriting OCR | Fallback manual entry; confidence flags; fine-tune prompt |
| Snowflake creds | Env vars + Vercel secrets; optional Supabase alt |
| High costs | Limit uploads; cache common products |
| Edge cases (cropped photos) | Auto-crop/preprocess with sharp.js |

## 11. Next Steps

1. **Implement MVP** (2-4 hours est.)
2. Setup Snowflake staging table
3. Test with provided photos (e.g., 2026-03-26-closing-stock.jpg)
4. Product catalogue integration (JSON lookup for normalization)
5. dbt transforms on Snowflake data (per doc.md)

**Ready to build?** Confirm Snowflake creds/env vars, and I can create the full Next.js app.
