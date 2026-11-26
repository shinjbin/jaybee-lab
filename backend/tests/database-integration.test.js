const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");
const { migrate } = require("../migrate");

test("migration is repeatable and the serving role can use data without DDL/admin access", {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  // This test creates roles and schema objects: only use the isolated CI DB.
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.pathname, "/security_test");
  const user = `test_app_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(32).toString("hex") + "\\'";
  const admin = new Pool({ connectionString: url.toString() });
  let runtime;
  try {
    const env = { MIGRATION_DATABASE_URL: url.toString(), DATABASE_USER: user,
      DATABASE_PASSWORD: password, POSTGRES_USER: decodeURIComponent(url.username) };
    await migrate(env);
    await migrate(env);
    url.username = user;
    url.password = password;
    runtime = new Pool({ connectionString: url.toString(), statement_timeout: 5000 });
    const { rows } = await runtime.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
      rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    assert.ok(Object.values(rows[0]).every(value => value === false));
    const result = await runtime.query(`INSERT INTO ai_market_analysis (analysis_date, content)
      VALUES ('2026-10-12', 'security integration') RETURNING id`);
    await runtime.query("SELECT * FROM ai_market_analysis WHERE id = $1", [result.rows[0].id]);
    await runtime.query("UPDATE ai_market_analysis SET title='updated' WHERE id=$1", [result.rows[0].id]);
    await runtime.query("DELETE FROM ai_market_analysis WHERE id=$1", [result.rows[0].id]);
    const snapshot = { symbol: "TEST", price: 100, history: [{ date: "2026-10-12", close: 100 }] };
    await runtime.query(`INSERT INTO market_index_snapshots (symbol, payload, refreshed_at)
      VALUES ($1, $2::jsonb, now()) ON CONFLICT (symbol) DO UPDATE SET payload = EXCLUDED.payload`,
      [snapshot.symbol, JSON.stringify(snapshot)]);
    const stored = await runtime.query("SELECT payload FROM market_index_snapshots WHERE symbol = $1", [snapshot.symbol]);
    assert.deepEqual(stored.rows[0].payload, snapshot);
    await runtime.query("DELETE FROM market_index_snapshots WHERE symbol = $1", [snapshot.symbol]);
    await assert.rejects(runtime.query("CREATE TABLE forbidden(id int)"), error => error.code === "42501");
    await assert.rejects(runtime.query("ALTER TABLE news_articles ADD COLUMN forbidden int"), error => error.code === "42501");
    await assert.rejects(runtime.query("CREATE ROLE forbidden LOGIN"), error => error.code === "42501");
    await assert.rejects(runtime.query("SELECT * FROM pg_authid"), error => error.code === "42501");
  } finally {
    await runtime?.end();
    await admin.query(`DROP OWNED BY "${user}"`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS "${user}"`);
    await admin.end();
  }
});
