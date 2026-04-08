# Asian Grocer Smart Stock 🛒📋

The **Smart Stock Management System** is an intelligent, AI-powered pipeline designed to bridge the gap between fast, physical handwritten stock-taking and structured digital inventory data. 

By capturing a photo of a handwritten closing stock sheet, this application leverages advanced Vision Models (OpenAI) to extract, validate, and dynamically map hundreds of handwritten inventory quantities directly into a pristine digital spreadsheet—drastically reducing manual data entry for staff.

## 🚀 Key Features

- **Dynamic CSV-Driven Architecture:** The entire AI extraction logic and UI is powered by a central master `catalog_v2.csv`. If your grocery inventory changes, simply update the CSV. No code changes required. The AI uses the layout coordinates in the catalog to visually navigate the page.
- **Intelligent Vision OCR:** 
  - Extracts both strictly printed items and completely novel handwritten items tacked onto the end of physical sections.
  - Intelligently ignores "pack sizes" (like `12kg`, `punnets`) from being mistakenly read as stock quantities.
  - Explicitly recognizes **Red Annotation Circles** (marks used by wholesale buyers indicating an item is selling well) and logs them into background notes without hallucinating them as a `0` quantity.
- **Visual "Paper-Like" Verification UI:** Instead of spitting out an unreadable JSON wall, the React frontend renders a digital twin of the physical stocklist paper, divided into native physical groups (`Inside Coolroom`, `Stonefruit`, etc.).
- **Staff Inspection Handling:** Unmapped or entirely new handwritten items are funneled into a visually distinct **"Unclassified / Staff Inspection"** grid with red error-states, while skipped/missing catalog items are rendered locally in amber.
- **Data Export Pipeline:** Once the staff verify the inputs on the digital interface, the data exports into a strict, unified 11-column CSV format ready for downstream POS and wholesale databases.

## 🧰 Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + Vanilla CSS Layouting
- **Validation:** Zod (strict schema mapping for GPT response reliability)
- **AI Backend:** OpenAI API (`gpt-4.5` / `gpt-5.x` compatible)
- **Parsing:** PapaParse (for robust client/server CSV streaming)

## 🛠️ Getting Started

1. **Environment Variables:**
   Ensure you have a `.env.local` file at the root of the `web-app` directory with:
   ```env
   OPENAI_API_KEY="sk-..."
   OPENAI_VISION_MODEL="gpt-4o" # or gpt-4.5-preview / gpt-5.4
   NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
   ```

2. **Run Supabase SQL Migration:**
   Execute `web-app/supabase/migrations/20260408_auth_events.sql` in your Supabase SQL editor.
   Then execute `web-app/supabase/migrations/20260408_normalize_events.sql`.
   Then execute `web-app/supabase/migrations/20260408_catalog_db.sql`.
   If your catalog tables were already created, also execute `web-app/supabase/migrations/20260408_catalog_add_code.sql` to add the `code` column.
   This creates:
   - `user_roles` (multiple roles per user)
   - `event_generate`
   - `event_stock_check`
   - `event_catalog_save`
   - `event_push`
   - `catalog_versions`
   - `catalog_entries`
   - Row Level Security policies for per-user access and admin override
   Event tables are normalized to store `user_id` as the user reference source.

3. **Catalog Workflow (Database-backed):**
   - On first use, upload a catalog CSV from the UI to store it in Supabase.
   - After upload, choose catalog versions from the dropdown (loaded from database) for parsing.
   - The selected DB catalog is sent to the parser for each run.

4. **Run The Application:**
   ```bash
   cd web-app
   npm install
   npm run dev
   ```
   Navigate to `http://localhost:3000` to access the parser dashboard.

5. **Sign In:**
   Open `http://localhost:3000/login` to sign up/sign in with email + password.

6. **Uploading Data:** Choose a DB catalog version, upload a high-quality photo of your closing stocklist, and hit parse!

## 🔮 Next Phases / Roadmap

* **Persistent Catalog Editing:** Currently, the Catalog Viewer UI allows temporary inline schema modification. The next phase involves setting up an endpoint to automatically write permanent edits back to `catalog_v2.csv` on the server disk.
* **Mobile-First Capture UI:** Optimizing the dashboard specifically for iPad/Mobile so stock-takers can snap a photo directly from the iOS/Android camera roll while physically standing in the coolroom.
* **Historical Analytics & "Buy-More" Tracking:** Building an analytics route to aggregate the `sell_marker: true` (Red Circle markings) over 30 days to highlight highly-velocity items immediately to the purchasing team. 
* **Multi-Page Parsing Support:** Allowing the upload of `PDF` files or batched sequences of images to process multi-page stock forms in a single API flight. 
