/**
 * Integration test: exercises the full community CRUD lifecycle over HTTP
 * against a real PostgreSQL database. Requires DATABASE_URL pointing at a
 * migrated database; skipped automatically when DATABASE_URL is not set.
 */

import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { Pool } from 'pg';
import app from '../../../app';
import { db } from '../../../db';
import { makeTestPool, truncateAll } from '../../../test/fixtures';

const RUN = Boolean(process.env.DATABASE_URL);
const describeIf = RUN ? describe : describe.skip;

describeIf('Community CRUD (integration)', () => {
  let pool: Pool;
  const issuer = Keypair.random().publicKey();
  const member = Keypair.random().publicKey();

  beforeAll(async () => {
    pool = makeTestPool();
    const client = await pool.connect();
    try {
      await truncateAll(client);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await truncateAll(client);
    } finally {
      client.release();
    }
    await pool.end();
    await db.end();
  });

  let communityId: string;

  it('creates a community', async () => {
    const res = await request(app).post('/api/v1/communities').send({
      name: 'IntegrationDAO',
      description: 'Created by integration test',
      issuerPublicKey: issuer,
      assetCode: 'INTG',
      assetIssuer: issuer,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    communityId = res.body.data.id;
  });

  it('rejects a duplicate community name with 409', async () => {
    const res = await request(app).post('/api/v1/communities').send({
      name: 'IntegrationDAO',
      issuerPublicKey: issuer,
      assetCode: 'INTG',
      assetIssuer: issuer,
    });
    expect(res.status).toBe(409);
  });

  it('lists the community with pagination meta', async () => {
    const res = await request(app).get('/api/v1/communities?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((c: { id: string }) => c.id === communityId)).toBe(true);
  });

  it('fetches and enriches a single community', async () => {
    const res = await request(app).get(`/api/v1/communities/${communityId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('IntegrationDAO');
    expect(res.body.data.member_count).toBe(0);
    expect(res.body.data.stats).toBeDefined();
  });

  it('finds the community via full-text search', async () => {
    const res = await request(app).get('/api/v1/communities/search?q=IntegrationDAO');
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === communityId)).toBe(true);
  });

  it('updates the community', async () => {
    const res = await request(app)
      .put(`/api/v1/communities/${communityId}`)
      .send({ description: 'Updated description' });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated description');
  });

  it('sets the community avatar', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/avatar`)
      .send({ avatarUrl: 'https://cdn.example.com/intg.png' });
    expect(res.status).toBe(200);
    expect(res.body.data.avatar_url).toBe('https://cdn.example.com/intg.png');
  });

  it('adds and lists a member', async () => {
    const add = await request(app)
      .post(`/api/v1/communities/${communityId}/members`)
      .send({ stellarAddress: member, role: 'treasurer' });
    expect(add.status).toBe(201);

    const list = await request(app).get(`/api/v1/communities/${communityId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].stellar_address).toBe(member);
  });

  it('soft-removes a member and hides them from the list', async () => {
    const del = await request(app).delete(`/api/v1/communities/${communityId}/members/${member}`);
    expect(del.status).toBe(200);
    expect(del.body.data.removed).toBe(true);

    const list = await request(app).get(`/api/v1/communities/${communityId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(0);

    const getOne = await request(app).get(
      `/api/v1/communities/${communityId}/members/${member}`
    );
    expect(getOne.status).toBe(404);
  });

  it('re-adding a removed member clears the soft delete', async () => {
    const add = await request(app)
      .post(`/api/v1/communities/${communityId}/members`)
      .send({ stellarAddress: member, role: 'member' });
    expect(add.status).toBe(201);

    const list = await request(app).get(`/api/v1/communities/${communityId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
  });

  it('soft-deletes the community and hides it from reads', async () => {
    const del = await request(app).delete(`/api/v1/communities/${communityId}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const after = await request(app).get(`/api/v1/communities/${communityId}`);
    expect(after.status).toBe(404);
  });
});
