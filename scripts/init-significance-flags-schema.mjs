import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL or DATABASE_URL_UNPOOLED is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

async function main() {
  await pool.query(`
    create table if not exists summary_significance_flags (
      id bigserial primary key,
      repo_id bigint not null references repositories(id) on delete cascade,
      issue_number integer not null,
      snapshot_id text references snapshots(id) on delete cascade,
      change text not null,
      significance text not null,
      change_group text not null,
      reason text not null,
      related_commit_ids text[] not null default '{}',
      evidence_refs text[] not null default '{}',
      evidence_source text not null,
      raw jsonb not null
    );

    alter table summary_change_contrast
      add column if not exists change_group text;

    alter table issue_summaries
      add column if not exists source_last_commit_at timestamptz;

    alter table issue_summaries
      add column if not exists source_fingerprint text;

    alter table issue_summaries
      add column if not exists reused_from_generated_at timestamptz;

    create index if not exists summary_significance_flags_repo_issue_idx
      on summary_significance_flags (repo_id, issue_number);

    create index if not exists summary_significance_flags_significance_idx
      on summary_significance_flags (repo_id, significance, change_group);

    create index if not exists issue_summaries_source_commit_idx
      on issue_summaries (repo_id, source_last_commit_at);
  `);

  const result = await pool.query(
    "select to_regclass('public.summary_significance_flags') as table_name",
  );

  console.log(
    JSON.stringify({ ok: true, table: result.rows[0].table_name }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
