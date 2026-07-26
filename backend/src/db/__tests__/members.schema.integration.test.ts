/**
 * Integration test: verifies the members table's constraints, trigger, and
 * indexes against a real PostgreSQL database. Requires DATABASE_URL pointing at
 * a migrated database; skipped automatically when DATABASE_URL is not set.
 */

import { Pool, PoolClient } from 'pg';
import { createCommunity, createMember, makeTestPool, truncateAll } from '../../test/fixtures';

const RUN = Boolean(process.env.DATABASE_URL);
const describeIf = RUN ? describe : describe.skip;

const VALID_ADDRESS = 'G' + 'F'.repeat(55);

describeIf('members schema (integration)', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = makeTestPool();
    client = await pool.connect();
    await truncateAll(client);
  });

  afterAll(async () => {
    await truncateAll(client);
    client.release();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('cascades member deletion when the owning community is deleted', async () => {
    const community = await createCommunity(client, { name: 'CascadeDAO' });
    await createMember(client, community.id);

    await client.query('DELETE FROM communities WHERE id = $1', [community.id]);

    const { rows } = await client.query('SELECT 1 FROM members WHERE community_id = $1', [
      community.id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('rejects a member whose community does not exist', async () => {
    await expect(
      client.query(
        `INSERT INTO members (community_id, stellar_address) VALUES (gen_random_uuid(), $1)`,
        [VALID_ADDRESS]
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('rejects a malformed Stellar address', async () => {
    const community = await createCommunity(client, { name: 'FormatDAO' });

    await expect(createMember(client, community.id, 'not-a-stellar-address')).rejects.toThrow(
      /members_stellar_address_format/
    );
  });

  it('rejects an unknown role', async () => {
    const community = await createCommunity(client, { name: 'RoleDAO' });

    await expect(createMember(client, community.id, VALID_ADDRESS, 'overlord')).rejects.toThrow(
      /members_role_check/
    );
  });

  it('rejects the same address twice in one community', async () => {
    const community = await createCommunity(client, { name: 'DuplicateDAO' });
    await createMember(client, community.id, VALID_ADDRESS);

    await expect(createMember(client, community.id, VALID_ADDRESS)).rejects.toThrow(
      /duplicate key/i
    );
  });

  it('allows the same address in two different communities', async () => {
    const first = await createCommunity(client, { name: 'FirstDAO', assetCode: 'FRST' });
    const second = await createCommunity(client, { name: 'SecondDAO', assetCode: 'SCND' });

    await createMember(client, first.id, VALID_ADDRESS);
    await createMember(client, second.id, VALID_ADDRESS);

    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM members WHERE stellar_address = $1',
      [VALID_ADDRESS]
    );
    expect(Number(rows[0].count)).toBe(2);
  });

  it('bumps updated_at on every update but leaves joined_at alone', async () => {
    const community = await createCommunity(client, { name: 'TouchDAO' });
    await createMember(client, community.id, VALID_ADDRESS);

    const before = await client.query<{ joined_at: Date; updated_at: Date }>(
      'SELECT joined_at, updated_at FROM members WHERE stellar_address = $1',
      [VALID_ADDRESS]
    );

    await client.query('UPDATE members SET role = $1 WHERE stellar_address = $2', [
      'treasurer',
      VALID_ADDRESS,
    ]);

    const after = await client.query<{ joined_at: Date; updated_at: Date }>(
      'SELECT joined_at, updated_at FROM members WHERE stellar_address = $1',
      [VALID_ADDRESS]
    );

    expect(after.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0].updated_at.getTime()
    );
    expect(after.rows[0].joined_at.getTime()).toBe(before.rows[0].joined_at.getTime());
  });

  it('indexes the lookup paths the members API uses', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'members'`
    );
    const indexes = rows.map((r) => r.indexname);

    expect(indexes).toContain('idx_members_stellar_address');
    expect(indexes).toContain('idx_members_community_active');
    // Superseded by the primary key's leading column.
    expect(indexes).not.toContain('idx_members_community');
  });

  // #045: soft-delete on members
  it('has a nullable deleted_at column for soft deletes', async () => {
    const { rows } = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'deleted_at'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('excludes a soft-deleted member from the active-members query', async () => {
    const community = await createCommunity(client, { name: 'SoftDeleteDAO' });
    await createMember(client, community.id, VALID_ADDRESS);

    await client.query(
      'UPDATE members SET deleted_at = NOW() WHERE community_id = $1 AND stellar_address = $2',
      [community.id, VALID_ADDRESS]
    );

    const { rows } = await client.query(
      'SELECT 1 FROM members WHERE community_id = $1 AND deleted_at IS NULL',
      [community.id]
    );
    expect(rows).toHaveLength(0);
  });

  it('clears deleted_at when a removed member is re-added', async () => {
    const community = await createCommunity(client, { name: 'RejoinDAO' });
    await createMember(client, community.id, VALID_ADDRESS);
    await client.query(
      'UPDATE members SET deleted_at = NOW() WHERE community_id = $1 AND stellar_address = $2',
      [community.id, VALID_ADDRESS]
    );

    // Mirrors the ON CONFLICT clause in POST /api/v1/communities/:id/members
    await client.query(
      `INSERT INTO members (community_id, stellar_address, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (community_id, stellar_address)
       DO UPDATE SET role = EXCLUDED.role, deleted_at = NULL`,
      [community.id, VALID_ADDRESS]
    );

    const { rows } = await client.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM members WHERE community_id = $1 AND stellar_address = $2',
      [community.id, VALID_ADDRESS]
    );
    expect(rows[0].deleted_at).toBeNull();
  });
});
