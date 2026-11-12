import { expect, it, vi } from 'vitest';
import { ApiSession } from './session';
const staffId = '00000000-0000-4000-8000-000000000001';
const shopId = '00000000-0000-4000-8000-000000000002';
function storage() {
  let saved: string | null = null;
  return {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
    clear: () => {
      saved = null;
    },
  };
}
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
it('stores only an API session token and clears it on logout', async () => {
  const store = storage();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        data: {
          token: 'opaque-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          user: { id: staffId, shopId },
        },
      }),
    )
    .mockResolvedValueOnce(response({ data: { signedOut: true } }));
  const session = new ApiSession('https://shop.example', store, transport);
  expect(
    (await session.signInWithPassword({ username: 'admin', password: 'private-password' })).error,
  ).toBeNull();
  expect(transport.mock.calls[0]?.[0]).toBe('https://shop.example/api/v1/auth/login');
  expect(store.read()).not.toContain('private-password');
  expect((await session.getSession()).data.session?.user.shopId).toBe(shopId);
  await session.signOut();
  expect(store.read()).toBeNull();
});
it('rejects bad credentials without persisting a session', async () => {
  const store = storage();
  const session = new ApiSession(
    'https://shop.example',
    store,
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ error: { message: 'Username or password is incorrect' } }, 401),
      ),
  );
  expect(
    (await session.signInWithPassword({ username: 'admin', password: 'wrong' })).error?.message,
  ).toContain('incorrect');
  expect(store.read()).toBeNull();
});
