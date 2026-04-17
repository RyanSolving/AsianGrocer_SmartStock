const fs = require('fs')
const path = require('path')
const snowflake = require('snowflake-sdk')

function readEnvFile(filePath) {
  const env = Object.create(null)
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

function quotedIdentifier(name) {
  return `"${String(name).toUpperCase().replaceAll('"', '""')}"`
}

function qualifiedTable(db, schema, table) {
  return [db, schema, table].map(quotedIdentifier).join('.')
}

async function main() {
  const envPath = path.join(process.cwd(), '.env.local')
  const env = readEnvFile(envPath)

  const database = env.SNOWFLAKE_DASHBOARD_DB || env.SNOWFLAKE_DB || env.SNOWFLAKE_DATABASE
  const schema = env.SNOWFLAKE_DASHBOARD_SCHEMA || env.SNOWFLAKE_SCHEMA

  const tables = {
    fact: qualifiedTable(database, schema, env.SNOWFLAKE_DASHBOARD_FACT_TABLE || 'FACT_TABLE'),
    product: qualifiedTable(database, schema, env.SNOWFLAKE_DASHBOARD_PRODUCT_TABLE || 'DIM_PRODUCT'),
    category: qualifiedTable(database, schema, env.SNOWFLAKE_DASHBOARD_CATEGORY_TABLE || 'DIM_PROD_CAT'),
    location: qualifiedTable(database, schema, env.SNOWFLAKE_DASHBOARD_LOCATION_TABLE || 'DIM_LOCATION'),
  }

  const connection = snowflake.createConnection({
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USER,
    password: env.SNOWFLAKE_PASSWORD,
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database,
    schema,
    role: env.SNOWFLAKE_ROLE,
  })

  const execute = (label, sqlText, binds) =>
    new Promise((resolve) => {
      connection.execute({
        sqlText,
        binds,
        complete(error, _statement, rows) {
          if (error) {
            console.log(`${label}: ERROR`)
            console.log(error.message)
          } else {
            console.log(`${label}: OK (rows=${(rows || []).length})`)
          }

          resolve()
        },
      })
    })

  await new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  const baseSql = `
    SELECT
      f.PHOTO_ID,
      f.STOCK_DATE,
      f.MODE,
      f.CLEANED_AT,
      f.QUANTITY,
      COALESCE(dp.OFFICIAL_NAME, dp.PRODUCT, f.CATALOG_CODE, 'Unknown') AS PRODUCT_NAME,
      COALESCE(dpc.CATEGORY, 'Unknown') AS CATEGORY_NAME,
      COALESCE(dl.LOCATION, 'Unknown') AS LOCATION_NAME,
      COALESCE(f.SUB_LOCATION, 'Unknown') AS SUB_LOCATION_NAME
    FROM ${tables.fact} f
    LEFT JOIN ${tables.product} dp
      ON f.PRODUCT_SK = dp.PRODUCT_SK
    LEFT JOIN ${tables.category} dpc
      ON f.PROD_CAT_SK = dpc.PROD_CAT_SK
    LEFT JOIN ${tables.location} dl
      ON f.LOCATION_SK = dl.LOCATION_SK
    WHERE f.STOCK_DATE %DATE_PRED%
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY f.STOCK_DATE, f.PRODUCT_SK, f.LOCATION_SK, f.SUB_LOCATION, f.MODE
      ORDER BY f.CLEANED_AT DESC NULLS LAST, f.PHOTO_ID DESC
    ) = 1
    ORDER BY f.STOCK_DATE ASC, PRODUCT_NAME ASC, LOCATION_NAME ASC, SUB_LOCATION_NAME ASC
  `

  const overviewSql = baseSql.replace('%DATE_PRED%', '= TO_DATE(?)')
  const stockLevelSql = baseSql.replace('%DATE_PRED%', 'IN (TO_DATE(?), DATEADD(DAY, -1, TO_DATE(?)))')

  await execute('OVERVIEW_SQL', overviewSql, ['2026-04-16'])
  await execute('STOCKLEVEL_SQL', stockLevelSql, ['2026-04-16', '2026-04-16'])

  await new Promise((resolve) => connection.destroy(() => resolve()))
}

main().catch((error) => {
  console.error('SCRIPT ERROR')
  console.error(error.message)
  process.exitCode = 1
})
