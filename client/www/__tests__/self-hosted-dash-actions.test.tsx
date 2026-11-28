// SidekickDB: a self-hosted dashboard does not lead people to actions the
// server refuses.
import { afterEach, expect, test, vi } from 'vitest';
import type { InstantApp, OAuthServiceProvider } from '@/lib/types';
import type { Role } from '@/pages/dash';

vi.mock('@/components/dash/MainDashLayout', () => ({
  useFetchedDash: () => ({ data: { apps: [] } }),
}));
// HomeButton reads window.location, which a server render does not have.
vi.mock('@/pages/dash', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  HomeButton: () => null,
}));
// lib/toast.js has JSX in a .js file, which the test transform does not read.
vi.mock('@/lib/toast', () => ({
  errorToast: () => {},
  infoToast: () => {},
  successToast: () => {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Loads the renderer with the components so both use the same React.
async function load(selfHosted: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', selfHosted ? 'true' : '');
  vi.resetModules();
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AddGoogleClientForm } = await import('@/components/dash/auth/Google');
  const { Admin } = await import('@/components/admin/AdminPage');

  const googleForm = () =>
    renderToStaticMarkup(
      <AddGoogleClientForm
        app={{ id: 'app-1' } as InstantApp}
        provider={{ id: 'p-1' } as OAuthServiceProvider}
        onAddClient={() => {}}
        onCancel={() => {}}
        usedClientNames={new Set()}
      />,
    );

  const admin = (role: Role) =>
    renderToStaticMarkup(
      <Admin
        app={
          {
            id: 'app-1',
            pro: false,
            title: 'App',
            admin_token: 'token',
            members: [],
            invites: [],
          } as unknown as InstantApp
        }
        onDelete={() => {}}
        role={role}
        nav={() => {}}
        workspace={{ type: 'personal', apps: [] }}
      />,
    );

  return { googleForm, admin };
}

// Each test imports the dashboard components and lib/config afresh, which is
// slow on a busy CI runner.
const slow = { timeout: 60_000 };

const sharedHint = 'If this server has shared dev credentials configured';

test(
  'self-hosted: a new Google web client starts with your own credentials',
  slow,
  async () => {
    const html = (await load(true)).googleForm();
    expect(html).toContain('Client ID from');
    expect(html).not.toContain(sharedHint);
    expect(html).toContain('Use dev credentials');
  },
);

test(
  'hosted: a new Google web client starts with dev credentials',
  slow,
  async () => {
    const html = (await load(false)).googleForm();
    expect(html).toContain(sharedHint);
  },
);

test(
  'self-hosted: only the owner gets the action to activate the included plan',
  slow,
  async () => {
    const { admin } = await load(true);
    expect(admin('owner')).toContain('Activate Pro for free');

    const html = admin('admin');
    expect(html).not.toContain('Activate Pro for free');
    expect(html).toContain('An owner of this app can activate it');
  },
);
