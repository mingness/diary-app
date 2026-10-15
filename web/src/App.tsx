/**
 * Routes and the session gate. Public screens (sign-in, register, forgot password) redirect away once signed
 * in; everything else needs a ready session, and a SYS_ADMIN without an authenticator sees only its setup.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  ScrollRestoration,
  createBrowserRouter,
  useRouteError,
  type RouteObject,
} from 'react-router';
import type { Role } from '@diary/shared';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './api/client.js';
import { useMe, useSession, type Session } from './api/session.js';
import { AppShell } from './components/AppShell.js';
import { AuthLayout } from './components/AuthLayout.js';
import { Button } from './components/Button.js';
import { shortRef } from './components/Notice.js';
import { EmptyState, ErrorState, LoadingState } from './components/States.js';
import { useT } from './i18n/index.js';
import { applyAppearance } from './lib/appearance.js';
import { landingPath, rememberedDestination } from './lib/landing.js';
import { AccountScreen } from './screens/account/AccountScreen.js';
import { EnrolScreen } from './screens/auth/EnrolScreen.js';
import { ForgotPasswordScreen } from './screens/auth/ForgotPasswordScreen.js';
import { LoginScreen } from './screens/auth/LoginScreen.js';
import { RegisterScreen } from './screens/auth/RegisterScreen.js';
import { MyDiaryScreen } from './screens/diary/MyDiaryScreen.js';
import { OpenDiaryScreen } from './screens/diary/OpenDiaryScreen.js';

/** Waits for the session; a failed check (not "signed out", which is a valid answer) offers a retry. */
function SessionGate({ children }: { children: (session: Session) => ReactNode }) {
  const query = useSession();
  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

function PublicLayout() {
  return (
    <SessionGate>
      {(session) =>
        session.status === 'ready' || session.status === 'enrol' ? (
          <Navigate to="/" replace />
        ) : (
          <Outlet />
        )
      }
    </SessionGate>
  );
}

function PrivateLayout() {
  return (
    <SessionGate>
      {(session) => {
        if (session.status === 'anonymous' || session.status === 'totp') {
          return <Navigate to="/login" replace />;
        }
        if (session.status === 'enrol') return <EnrolScreen />;
        return (
          <>
            <ApplyAppearance fontSize={session.me.fontSize} theme={session.me.theme} />
            <AppShell role={session.me.role}>
              <Outlet />
            </AppShell>
          </>
        );
      }}
    </SessionGate>
  );
}

/** Keeps the page in step with the signed-in user's saved text size and theme. */
function ApplyAppearance({ fontSize, theme }: Parameters<typeof applyAppearance>[0]) {
  useEffect(() => applyAppearance({ fontSize, theme }), [fontSize, theme]);
  return null;
}

/** Screens for some roles only; the server refuses the others anyway, this just shows "not found". */
function ForRoles({ roles }: { roles: readonly Role[] }) {
  const me = useMe();
  return roles.includes(me.role) ? <Outlet /> : <NotFound />;
}

/** Until 報數 (slice 16) and the leader and admin homes (slices 14–15) exist, land somewhere real. */
function NotYetBuilt() {
  const me = useMe();
  return <Navigate to={me.role === 'SYS_ADMIN' ? '/me' : '/diary'} replace />;
}

const WRITERS: readonly Role[] = ['NORMAL_USER', 'COURSE_LEADER'];

/** Detail screens hide the phone tab bar and show a back button instead (FRONTEND.md §3). */
const detail = { handle: { detail: true } };

const diaryRoutes: RouteObject[] = [
  { path: '/diary', element: <MyDiaryScreen /> },
  { path: '/open', element: <OpenDiaryScreen /> },
  {
    // The Tiptap screens load on first use, so sign-in and the lists stay light.
    path: '/diary/:id/edit',
    ...detail,
    lazy: async () => ({
      Component: (await import('./screens/diary/EditorScreen.js')).EditorScreen,
    }),
  },
  {
    path: '/diary/:id',
    ...detail,
    lazy: async () => {
      const { EntryScreen } = await import('./screens/diary/EntryScreen.js');
      return { Component: () => <EntryScreen fallback="/diary" /> };
    },
  },
  {
    path: '/open/:id',
    ...detail,
    lazy: async () => {
      const { EntryScreen } = await import('./screens/diary/EntryScreen.js');
      return { Component: () => <EntryScreen fallback="/open" /> };
    },
  },
];

function Home() {
  const { data } = useSession();
  if (data?.status !== 'ready') return null;
  return <Navigate to={landingPath(data.me.role, rememberedDestination())} replace />;
}

function NotFound() {
  const t = useT();
  return (
    <EmptyState title={t('state.notFound')}>
      <Link to="/">{t('state.backHome')}</Link>
    </EmptyState>
  );
}

/** Last resort for a crash while rendering: a way out, and the error ref when the API was involved. */
function Crashed() {
  const t = useT();
  const error = useRouteError();
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <AuthLayout>
      <div role="alert">
        <h1>{t('state.crashed')}</h1>
        <p>{t('state.crashedDetail')}</p>
        {requestId && <p>{t('common.errorRef', { id: shortRef(requestId) })}</p>}
      </div>
      <Button variant="primary" wide onClick={() => window.location.assign('/')}>
        {t('state.reload')}
      </Button>
    </AuthLayout>
  );
}

const router = createBrowserRouter([
  {
    element: (
      <>
        <ScrollRestoration />
        <Outlet />
      </>
    ),
    errorElement: <Crashed />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/login', element: <LoginScreen /> },
          { path: '/register', element: <RegisterScreen /> },
          { path: '/forgot-password', element: <ForgotPasswordScreen /> },
        ],
      },
      {
        element: <PrivateLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: '/me', element: <AccountScreen /> },
          { element: <ForRoles roles={WRITERS} />, children: diaryRoutes },
          // Landing destinations whose screens arrive in later slices (ARCHITECTURE §11).
          ...['/count', '/review', '/admin'].map((path) => ({ path, element: <NotYetBuilt /> })),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
