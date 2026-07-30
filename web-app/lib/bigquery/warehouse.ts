import { BigQuery } from '@google-cloud/bigquery'

import type { WarehouseStagingRecord } from '../stock-schema'

const DEFAULT_PROJECT_ID = 'gen-lang-client-0274270007'
const DEFAULT_RAW_DATASET = 'raw_stocklist'
const DEFAULT_RAW_TABLE = 'stock_photos_raw'
const DEFAULT_DASHBOARD_DATASET = 'cleaned_stockdata'
const DEFAULT_DASHBOARD_TABLE = 'stock_items_flat'

type BigQueryParameter = string | number | boolean | null

type TableReference = {
  projectId: string
  dataset: string
  table: string
}

let cachedClient: BigQuery | null = null

function normalizePrivateKey(value: string) {
  return value
    .trim()
    .replace(/^['"]|['"],?$/g, '')
    .replace(/\\n/g, '\n')
    .trim()
}

function assertProjectId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/.test(value)) {
    throw new Error(`Invalid BigQuery project id: ${value}`)
  }
}

function assertDatasetOrTableId(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid BigQuery ${label}: ${value}`)
  }
}

function getProjectId() {
  return process.env.BIGQUERY_PROJECT_ID ?? DEFAULT_PROJECT_ID
}

function parseTableReference(input: string | undefined, defaultDataset: string, defaultTable: string): TableReference {
  const projectId = getProjectId()
  const trimmed = input?.trim()

  if (!trimmed) {
    return { projectId, dataset: defaultDataset, table: defaultTable }
  }

  const parts = trimmed.split('.').filter(Boolean)
  if (parts.length === 1) {
    return { projectId, dataset: defaultDataset, table: parts[0] }
  }

  if (parts.length === 2) {
    return { projectId, dataset: parts[0], table: parts[1] }
  }

  if (parts.length === 3) {
    return { projectId: parts[0], dataset: parts[1], table: parts[2] }
  }

  throw new Error(`Invalid BigQuery table reference: ${trimmed}`)
}

export function getMissingBigQueryEnvKeys() {
  const missing: string[] = []

  if (!process.env.BIGQUERY_PROJECT_ID) missing.push('BIGQUERY_PROJECT_ID')
  if (!process.env.BIGQUERY_CLIENT_EMAIL) missing.push('BIGQUERY_CLIENT_EMAIL')
  if (!process.env.BIGQUERY_PRIVATE_KEY) missing.push('BIGQUERY_PRIVATE_KEY')

  return missing
}

export function getBigQueryClient() {
  if (cachedClient) return cachedClient

  const projectId = getProjectId()
  const clientEmail = process.env.BIGQUERY_CLIENT_EMAIL
  const privateKey = process.env.BIGQUERY_PRIVATE_KEY

  if (!clientEmail || !privateKey) {
    throw new Error('BigQuery client_email and private_key environment variables are required.')
  }

  cachedClient = new BigQuery({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    },
  })

  return cachedClient
}

export function quoteBigQueryTable(reference: TableReference) {
  assertProjectId(reference.projectId)
  assertDatasetOrTableId(reference.dataset, 'dataset')
  assertDatasetOrTableId(reference.table, 'table')

  return `\`${reference.projectId}.${reference.dataset}.${reference.table}\``
}

export function getRawStockTableName() {
  const dataset = process.env.BIGQUERY_RAW_DATASET ?? DEFAULT_RAW_DATASET
  const tableReference = parseTableReference(process.env.BIGQUERY_RAW_TABLE, dataset, DEFAULT_RAW_TABLE)
  return quoteBigQueryTable(tableReference)
}

export function getDashboardStockItemsTableName() {
  const dataset = process.env.BIGQUERY_DASHBOARD_DATASET ?? DEFAULT_DASHBOARD_DATASET
  const tableReference = parseTableReference(process.env.BIGQUERY_DASHBOARD_TABLE, dataset, DEFAULT_DASHBOARD_TABLE)
  return quoteBigQueryTable(tableReference)
}

function getJobLocation() {
  return process.env.BIGQUERY_LOCATION?.trim() || undefined
}

export async function queryBigQueryRows(
  sqlText: string,
  params: Record<string, BigQueryParameter> = {},
) {
  const [rows] = await getBigQueryClient().query({
    query: sqlText,
    params,
    location: getJobLocation(),
  })

  return rows as Record<string, unknown>[]
}

export async function executeBigQuery(
  sqlText: string,
  params: Record<string, BigQueryParameter> = {},
) {
  const [job] = await getBigQueryClient().createQueryJob({
    query: sqlText,
    params,
    location: getJobLocation(),
  })

  await job.getQueryResults()

  return { queryId: job.id ?? null }
}

export async function ensureRawStockTableExists(tableName: string) {
  await executeBigQuery(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      photo_id STRING,
      mode STRING,
      validated STRING,
      upload_date STRING,
      stock_date DATE,
      photo_url STRING,
      total_items NUMERIC,
      confidence_overall STRING,
      item_data STRING,
      created_at STRING
    )
    PARTITION BY stock_date
  `)

  await executeBigQuery(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS mode STRING`)
  await executeBigQuery(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS validated STRING`)
}

export async function insertRawStockRecord(tableName: string, record: WarehouseStagingRecord) {
  return executeBigQuery(
    `
      INSERT INTO ${tableName} (
        photo_id,
        mode,
        validated,
        upload_date,
        stock_date,
        photo_url,
        total_items,
        confidence_overall,
        item_data,
        created_at
      )
      VALUES (
        @photo_id,
        @mode,
        @validated,
        @upload_date,
        DATE(@stock_date),
        NULLIF(@photo_url, ''),
        @total_items,
        @confidence_overall,
        @item_data,
        CAST(CURRENT_TIMESTAMP() AS STRING)
      )
    `,
    {
      photo_id: record.photo_id,
      mode: record.mode,
      validated: record.validated,
      upload_date: record.upload_date,
      stock_date: record.stock_date,
      photo_url: record.photo_url ?? '',
      total_items: record.total_items,
      confidence_overall: record.confidence_overall,
      item_data: JSON.stringify(record.item_data),
    },
  )
}
