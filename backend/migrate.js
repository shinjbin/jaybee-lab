const { Pool } = require("pg");
const schema = require("./src/schema");

function runtimeRoleSql(user, password) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(user || "") || user === "postgres" ||
      !password || password.length < 32 || password.startsWith("REPLACE_")) {
    throw new Error("Configure a dedicated runtime database user and random password of at least 32 characters.");
  }
  const role = `"${user}"`;
  const literal = `E'${password.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  return { role, literal };
}

async function migrate(env = process.env) {
  const { role, literal } = runtimeRoleSql(env.DATABASE_USER, env.DATABASE_PASSWORD);
  if (env.DATABASE_USER === env.POSTGRES_USER) throw new Error("Runtime and migration users must differ.");
  const pool = new Pool({ ...(env.MIGRATION_DATABASE_URL ? {
    connectionString: env.MIGRATION_DATABASE_URL
  } : { host: env.DATABASE_HOST || "postgres", database: env.POSTGRES_DB,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD }),
    max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 120_000 });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(17834101)");
    await client.query(schema);
    const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [env.DATABASE_USER]);
    if (!rows.length) await client.query(`CREATE ROLE ${role} LOGIN`);
    // Reject an existing owner/member role rather than leaving inherited access.
    const unsafe = await client.query(
      `SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)
       UNION ALL SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
       UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
       UNION ALL SELECT 1 FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [env.DATABASE_USER]);
    if (unsafe.rows.length) throw new Error("Runtime role must not own objects or inherit other roles.");
    await client.query(`ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal}`);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON
      news_articles, collector_runs, investor_flow_snapshots, investor_flow_universe,
      ai_market_analysis, brokerage_reports, brokerage_api_tokens TO ${role}`);
    await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(() => console.log("Database migration completed."), () => {
    // Driver errors can contain SQL statements with the role password.
    console.error("Database migration failed. Check migration credentials, runtime role and schema compatibility.");
    process.exitCode = 1;
  });
}

module.exports = { migrate, runtimeRoleSql };
