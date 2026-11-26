import { API, createApp, TestContext } from './utils';

describe('Foundation (US4)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /health reports the database as up', async () => {
    const res = await ctx.http().get(`${API}/health`).expect(200);
    expect(res.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });

  it('serves routes only under /api/v1', async () => {
    const res = await ctx.http().get('/health').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', path: '/health' });
  });

  it('returns the consistent error shape for validation errors', async () => {
    const res = await ctx.http().post(`${API}/auth/register`).send({}).expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: expect.arrayContaining([expect.stringContaining('fullName')]),
      path: `${API}/auth/register`,
      timestamp: expect.any(String),
    });
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('rejects unknown fields', async () => {
    const res = await ctx
      .http()
      .post(`${API}/auth/login`)
      .send({ identifier: 'a@b.co', password: 'x', isAdmin: true })
      .expect(400);
    expect(res.body.message).toContain('property isAdmin should not exist');
  });

  it('requires authentication on protected routes by default', async () => {
    const res = await ctx.http().get(`${API}/users/me`).expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
  });

  it('publishes OpenAPI docs listing every route', async () => {
    const res = await ctx.http().get('/docs-json').expect(200);
    const paths = Object.keys(res.body.paths as object);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${API}/health`,
        `${API}/auth/register`,
        `${API}/auth/login`,
        `${API}/auth/refresh`,
        `${API}/auth/logout`,
        `${API}/auth/change-password`,
        `${API}/auth/me`,
        `${API}/users/me`,
        `${API}/users/me/addresses`,
        `${API}/users/me/addresses/{id}`,
        `${API}/regions`,
        `${API}/regions/{id}/districts`,
        `${API}/admin/users`,
        `${API}/admin/users/{id}`,
        `${API}/admin/users/{id}/status`,
        // Phase 2 — vendors (SC-007)
        `${API}/vendors/me`,
        `${API}/vendors/me/resubmit`,
        `${API}/vendors/me/logo`,
        `${API}/vendors/me/payout-account`,
        `${API}/vendors`,
        `${API}/vendors/{slug}`,
        `${API}/admin/vendors`,
        `${API}/admin/vendors/{id}`,
        `${API}/admin/vendors/{id}/approve`,
        `${API}/admin/vendors/{id}/reject`,
        `${API}/admin/vendors/{id}/suspend`,
        `${API}/admin/vendors/{id}/reactivate`,
        // Phase 3 — listings (SC-007)
        `${API}/vendors/me/listings`,
        `${API}/vendors/me/listings/{id}`,
        `${API}/vendors/me/listings/{id}/publish`,
        `${API}/vendors/me/listings/{id}/pause`,
        `${API}/vendors/me/listings/{id}/activate`,
        `${API}/vendors/me/listings/{id}/archive`,
        `${API}/vendors/me/listings/{id}/photos`,
        `${API}/vendors/me/listings/{id}/photos/{photoId}`,
        `${API}/vendors/me/listings/{id}/photos/order`,
        `${API}/listings`,
        `${API}/listings/{id}`,
        `${API}/admin/listings`,
        `${API}/admin/listings/{id}`,
        `${API}/admin/listings/{id}/take-down`,
        `${API}/admin/listings/{id}/restore`,
        // Phase 4 — cart & orders (SC-008)
        `${API}/cart`,
        `${API}/cart/items`,
        `${API}/cart/items/{listingId}`,
        `${API}/orders`,
        `${API}/orders/{id}`,
        `${API}/orders/{id}/sub-orders/{subOrderId}/cancel`,
        `${API}/vendors/me/orders`,
        `${API}/vendors/me/orders/{id}`,
        `${API}/vendors/me/orders/{id}/confirm`,
        `${API}/vendors/me/orders/{id}/dispatch`,
        `${API}/vendors/me/orders/{id}/deliver`,
        `${API}/vendors/me/orders/{id}/reject`,
        `${API}/vendors/me/orders/{id}/cancel`,
        `${API}/admin/orders`,
        `${API}/admin/orders/{id}`,
        `${API}/admin/orders/{id}/sub-orders/{subOrderId}/cancel`,
      ]),
    );
    const vendorsMe = res.body.paths[`${API}/vendors/me`] as Record<string, unknown>;
    expect(Object.keys(vendorsMe).sort()).toEqual(['get', 'patch', 'post']);
    const logo = res.body.paths[`${API}/vendors/me/logo`] as {
      put: { requestBody: { content: Record<string, unknown> } };
    };
    expect(Object.keys(logo.put.requestBody.content)).toEqual(['multipart/form-data']);
    const photos = res.body.paths[`${API}/vendors/me/listings/{id}/photos`] as {
      post: { requestBody: { content: Record<string, unknown> } };
    };
    expect(Object.keys(photos.post.requestBody.content)).toEqual(['multipart/form-data']);
    // 19 Phase 4 operations: 5 cart, 4 customer, 7 vendor, 3 admin.
    const ops = (path: string) => Object.keys(res.body.paths[`${API}${path}`] as object).sort();
    expect(ops('/cart')).toEqual(['delete', 'get']);
    expect(ops('/cart/items')).toEqual(['post']);
    expect(ops('/cart/items/{listingId}')).toEqual(['delete', 'patch']);
    expect(ops('/orders')).toEqual(['get', 'post']);
    expect(ops('/orders/{id}')).toEqual(['get']);
    expect(ops('/orders/{id}/sub-orders/{subOrderId}/cancel')).toEqual(['post']);
    expect(ops('/vendors/me/orders')).toEqual(['get']);
    expect(ops('/vendors/me/orders/{id}')).toEqual(['get']);
    for (const action of ['confirm', 'dispatch', 'deliver', 'reject', 'cancel']) {
      expect(ops(`/vendors/me/orders/{id}/${action}`)).toEqual(['post']);
    }
    expect(ops('/admin/orders')).toEqual(['get']);
    expect(ops('/admin/orders/{id}')).toEqual(['get']);
    expect(ops('/admin/orders/{id}/sub-orders/{subOrderId}/cancel')).toEqual(['post']);
    await ctx.http().get('/docs').expect(200);
  });
});
