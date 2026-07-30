const fs = require('fs')
const path = require('path')
const { BigQuery } = require('@google-cloud/bigquery')

const DEFAULT_PROJECT_ID = 'gen-lang-client-0274270007'

function normalizePrivateKey(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"],?$/g, '')
    .replace(/\\n/g, '\n')
    .trim()
}

function readEnvFile(filePath) {
  const env = Object.create(null)
  if (!fs.existsSync(filePath)) return env

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const key = match[1]
    let value = match[2].trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}

function tableRef(env, datasetKey, tableKey, defaultDataset, defaultTable) {
  const projectId = env.BIGQUERY_PROJECT_ID || DEFAULT_PROJECT_ID
  const dataset = env[datasetKey] || defaultDataset
  const table = env[tableKey] || defaultTable
  const parts = table.split('.').filter(Boolean)

  if (parts.length === 2) {
    return `\`${projectId}.${parts[0]}.${parts[1]}\``
  }

  if (parts.length === 3) {
    return `\`${parts[0]}.${parts[1]}.${parts[2]}\``
  }

  return `\`${projectId}.${dataset}.${table}\``
}

async function main() {
  const env = readEnvFile(path.join(process.cwd(), '.env.local'))
  const date = process.argv[2] || '2026-04-16'
  const sourceTable = tableRef(env, 'BIGQUERY_DASHBOARD_DATASET', 'BIGQUERY_DASHBOARD_TABLE', 'cleaned_stockdata', 'stock_items_flat')

  const client = new BigQuery({
    projectId: env.BIGQUERY_PROJECT_ID || DEFAULT_PROJECT_ID,
    credentials: {
      client_email: env.BIGQUERY_CLIENT_EMAIL,
      private_key: normalizePrivateKey(env.BIGQUERY_PRIVATE_KEY),
    },
  })

  const sqlText = `
    WITH normalized AS (
      SELECT
        CAST(f.photo_id AS STRING) AS photo_id,
        SAFE_CAST(f.stock_date AS DATE) AS stock_date,
        CAST(f.mode AS STRING) AS mode,
        COALESCE(
          SAFE_CAST(f.cleaned_at AS TIMESTAMP),
          SAFE_CAST(f.created_at AS TIMESTAMP),
          SAFE_CAST(f.upload_date AS TIMESTAMP),
          CURRENT_TIMESTAMP()
        ) AS cleaned_at,
        COALESCE(SAFE_CAST(f.quantity AS FLOAT64), 0) AS quantity,
        COALESCE(CAST(f.official_name AS STRING), CAST(f.product AS STRING), CAST(f.catalog_code AS STRING), 'Unknown') AS product_name,
        COALESCE(CAST(f.category AS STRING), 'Unknown') AS category,
        COALESCE(CAST(f.location AS STRING), 'Unknown') AS location,
        COALESCE(CAST(f.sub_location AS STRING), 'Unknown') AS sub_location
      FROM ${sourceTable} f
      WHERE SAFE_CAST(f.stock_date AS DATE) IN (DATE(@selected_date), DATE_SUB(DATE(@selected_date), INTERVAL 1 DAY))
    )
    SELECT *
    FROM normalized
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY stock_date, product_name, location, sub_location, mode
      ORDER BY cleaned_at DESC NULLS LAST, photo_id DESC
    ) = 1
    ORDER BY stock_date ASC, product_name ASC, location ASC, sub_location ASC
  `

  const [rows] = await client.query({
    query: sqlText,
    params: { selected_date: date },
    location: env.BIGQUERY_LOCATION || undefined,
  })

  console.log(`DASHBOARD_SQL: OK (rows=${rows.length})`)
}

main().catch((error) => {
  console.error('SCRIPT ERROR')
  console.error(error.message)
  process.exitCode = 1
})
