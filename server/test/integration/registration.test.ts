/** Self-registration can be closed (REGISTRATION_OPEN=false) while admins still create accounts. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthOptions, ErrorBody } from '@diary/shared';
import {
  as,
  createTestApp,
  login,
  register,
  signedInAdmin,
  TEST_PASSWORD,
  type TestApp,
} from '../helpers/app.js';

const apps: TestApp[] = [];
let closed: TestApp;
let open: TestApp;
beforeAll(async () => {
  closed = await createTestApp({ env: { REGISTRATION_OPEN: 'false' } });
  open = await createTestApp();
  apps.push(closed, open);
});
afterAll(async () => {
  await Promise.all(apps.map((t) => t.close()));
});

const options = async (t: TestApp) =>
  AuthOptions.parse((await t.app.inject({ method: 'GET', url: '/api/auth/options' })).json());

describe('registration', () => {
  it('works while open, and the sign-in screen is told so', async () => {
    expect(await options(open)).toEqual({ registration: true });
    expect((await register(open.app, { username: 'newcomer1' })).statusCode).toBe(201);
    expect((await login(open.app, 'newcomer1')).res.statusCode).toBe(200);
  });

  it('when closed, is refused (before the form is even checked) and no account appears', async () => {
    expect(await options(closed)).toEqual({ registration: false });
    const refused = await register(closed.app, { username: 'newcomer2' });
    expect(refused.statusCode).toBe(403);
    expect(ErrorBody.parse(refused.json()).code).toBe('registration_closed');
    const empty = await closed.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {},
    });
    expect(ErrorBody.parse(empty.json()).code).toBe('registration_closed');
    expect((await login(closed.app, 'newcomer2')).res.statusCode).toBe(401);
  });

  it('when closed, a SYS_ADMIN can still create accounts', async () => {
    const admin = await signedInAdmin(closed);
    const created = await closed.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: as(admin),
      payload: {
        username: 'byadmin1',
        role: 'NORMAL_USER',
        credentials: { password: TEST_PASSWORD },
      },
    });
    expect(created.statusCode).toBe(201);
    expect((await login(closed.app, 'byadmin1')).res.statusCode).toBe(200);
  });
});
