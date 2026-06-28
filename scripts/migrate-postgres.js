const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run Postgres migrations.");
  }

  const sql = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Postgres schema migrated.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
