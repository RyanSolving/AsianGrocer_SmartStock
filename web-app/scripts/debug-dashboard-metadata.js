const fs = require('fs')
const path = require('path')
const snowflake = require('snowflake-sdk')

function readEnvFile(filePath) {
  const env = Object.create(null)
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
  const database = env.SNOWFLAKE_DASHBOARD_DB || env.SNOWFLAKE_DB || env.SNOWFLAKE_DATABASE
  const schema = env.SNOWFLAKE_DASHBOARD_SCHEMA || env.SNOWFLAKE_SCHEMA

  const connection = snowflake.createConnection({
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USER,
    password: env.SNOWFLAKE_PASSWORD,
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database,
    schema,
    role: env.SNOWFLAKE_ROLE,
  })

  await new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) return reject(error)
      resolve()
    })
  })

  const run = (sqlText, binds = []) =>
    new Promise((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete(error, _statement, rows) {
          if (error) return reject(error)
          resolve(rows || [])
        },
      })
    })

  try {
    const tables = await run(
      `SELECT TABLE_NAME FROM ${database}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [schema]
    )
    console.log('TABLES')
    for (const row of tables) {
      console.log(String(row.TABLE_NAME))
    }

    const candidateTables = ['FACT_TABLE', 'DIM_PRODUCT', 'DIM_PROD_CAT', 'DIM_LOCATION', 'STOCK_PHOTOS_RAW']
    for (const tableName of candidateTables) {
      const cols = await run(
        `SELECT COLUMN_NAME, DATA_TYPE FROM ${database}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, tableName]
      )

      if (cols.length > 0) {
        console.log(`\nCOLUMNS ${tableName}`)
        for (const col of cols) {
          console.log(`${col.COLUMN_NAME} :: ${col.DATA_TYPE}`)
        }
      }
    }
  } finally {
    await new Promise((resolve) => connection.destroy(() => resolve()))
  }
}

main().catch((error) => {
  console.error('SCRIPT ERROR')
  console.error(error.message)
  process.exitCode = 1
})
