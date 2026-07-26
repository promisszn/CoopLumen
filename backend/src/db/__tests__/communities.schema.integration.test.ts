/**
 * Integration test: verifies the `communities` schema produced by
 * 002_create_communities.sql — columns, CHECK constraints and indexes.
 * Requires DATABASE_URL pointing at a migrated PostgreSQL instance.
 * Skipped automatically when DATABASE_URL is not set.
 */

import { Pool, PoolClient } from 'pg';
import { makeTestPool, TEST_ISSUER_1 } from '../../test/fixtures';

const RUN = Boolean(process.env.DATABASE_URL);
const describeIf = RUN ? describe : describe.skip;

const VALID_ROW = {
  name: 'ConstraintDAO',
  description: 'valid',
  issuer_public_key: TEST_ISSUER_1,
  asset_code: 'CDAO',
  asset_issuer: TEST_ISSUER_1,
};

describeIf('communities schema', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = makeTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // Every insert runs inside a transaction that is always rolled back, so the
  // suite never leaves rows behind for other integration tests.
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  async function insert(overrides: Partial<typeof VALID_ROW> = {}): Promise<void> {
    const row = { ...VALID_ROW, ...overrides };
    await client.query(
      `INSERT INTO communities (name, description, issuer_public_key, asset_code, asset_issuer)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.name, row.description, row.issuer_public_key, row.asset_code, row.asset_issuer]
    );
  }

  it('has every column of the full schema', async () => {
    const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'communities'`
    );
    const columns = new Map(rows.map((r) => [r.column_name, r.is_nullable]));

    expect([...columns.keys()].sort()).toEqual(
      [
        'asset_code',
        'asset_issuer',
        'avatar_url',
        'created_at',
        'deleted_at',
        'description',
        'id',
        'issuer_public_key',
        'name',
        'updated_at',
      ].sort()
    );
    expect(columns.get('name')).toBe('NO');
    expect(columns.get('issuer_public_key')).toBe('NO');
    expect(columns.get('deleted_at')).toBe('YES');
    expect(columns.get('avatar_url')).toBe('YES');
  });

  it('accepts a well-formed row', async () => {
    await expect(insert()).resolves.toBeUndefined();
  });

  it('rejects a name shorter than 2 characters', async () => {
    await expect(insert({ name: 'A' })).rejects.toThrow(/communities_name_check/);
  });

  it('rejects a name longer than 64 characters', async () => {
    await expect(insert({ name: 'x'.repeat(65) })).rejects.toThrow(/communities_name_check/);
  });

  it('rejects a description longer than 500 characters', async () => {
    await expect(insert({ description: 'x'.repeat(501) })).rejects.toThrow(
      /communities_description_check/
    );
  });

  it('rejects a non-alphanumeric asset code', async () => {
    await expect(insert({ asset_code: 'BAD-CODE' })).rejects.toThrow(
      /communities_asset_code_check/
    );
  });

  it('rejects an asset code longer than 12 characters', async () => {
    await expect(insert({ asset_code: 'A'.repeat(13) })).rejects.toThrow(
      /communities_asset_code_check/
    );
  });

  it('rejects a malformed issuer public key', async () => {
    await expect(insert({ issuer_public_key: 'not-a-stellar-key' })).rejects.toThrow(
      /communities_issuer_public_key_check/
    );
  });

  it('rejects a malformed asset issuer', async () => {
    await expect(insert({ asset_issuer: `G${'A'.repeat(54)}` })).rejects.toThrow(
      /communities_asset_issuer_check/
    );
  });

  it('rejects a duplicate name', async () => {
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('creates the indexes the community queries rely on', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'communities'`
    );
    const indexes = rows.map((r) => r.indexname);

    expect(indexes).toContain('idx_communities_active_created_at');
    expect(indexes).toContain('idx_communities_asset');
    // #047: GIN full-text search index, used by GET /communities/search
    expect(indexes).toContain('idx_communities_fts');
  });

  // #047: GIN full-text search index on communities(name, description)
  it('matches a community by name or description via to_tsvector', async () => {
    await insert({ name: 'FullTextDAO', description: 'a cooperative for artisans' });

    const byName = await client.query(
      `SELECT 1 FROM communities
       WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
             @@ plainto_tsquery('english', 'FullTextDAO')`
    );
    expect(byName.rowCount).toBe(1);

    const byDescription = await client.query(
      `SELECT 1 FROM communities
       WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
             @@ plainto_tsquery('english', 'artisans')`
    );
    expect(byDescription.rowCount).toBe(1);
  });

  it('uses the GIN index to serve the full-text search query', async () => {
    await insert({ name: 'PlannerDAO' });

    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT 1 FROM communities
       WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
             @@ plainto_tsquery('english', 'PlannerDAO')`
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toMatch(/idx_communities_fts/);
  });
});
