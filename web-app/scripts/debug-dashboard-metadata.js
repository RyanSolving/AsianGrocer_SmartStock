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

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

async function main() {
  const env = readEnvFile(path.join(process.cwd(), '.env.local'))
  const projectId = env.BIGQUERY_PROJECT_ID || DEFAULT_PROJECT_ID
  const client = new BigQuery({
    projectId,
    credentials: {
      client_email: env.BIGQUERY_CLIENT_EMAIL,
      private_key: normalizePrivateKey(env.BIGQUERY_PRIVATE_KEY),
    },
  })

  const datasets = [
    env.BIGQUERY_RAW_DATASET || 'raw_stocklist',
    'cleaned_stockdata',
    'analytics',
  ]

  for (const dataset of datasets) {
    const [tables] = await client.dataset(dataset).getTables()
    console.log(`\nTABLES ${projectId}.${dataset}`)
    for (const table of tables) {
      console.log(table.id)
    }
  }

  const candidates = [
    { dataset: env.BIGQUERY_RAW_DATASET || 'raw_stocklist', table: env.BIGQUERY_RAW_TABLE || 'stock_photos_raw' },
    { dataset: 'cleaned_stockdata', table: 'cleaned_data' },
    { dataset: env.BIGQUERY_DASHBOARD_DATASET || 'cleaned_stockdata', table: env.BIGQUERY_DASHBOARD_TABLE || 'stock_items_flat' },
  ]

  for (const candidate of candidates) {
    const tableId = candidate.table.includes('.') ? candidate.table.split('.').pop() : candidate.table
    const [metadata] = await client.dataset(candidate.dataset).table(tableId).getMetadata()

    console.log(`\nCOLUMNS ${projectId}.${candidate.dataset}.${tableId}`)
    for (const field of metadata.schema?.fields || []) {
      console.log(`${field.name} :: ${field.type}`)
    }
  }
}

main().catch((error) => {
  console.error('SCRIPT ERROR')
  console.error(error.message)
  process.exitCode = 1
})
