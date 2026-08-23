/** Porter Family Portal identity via /api/portal/auth/me */

export const APP_ID = 'word-paths';
const LOGIN_FALLBACK = '/words/';

/**
 * @returns {Promise<{ user: object|null, denied: boolean, error?: string }>}
 */
export async function resolveUser() {
  if (isLocalDev()) {
    const params = new URLSearchParams(location.search);
    if (params.get('dev') === '1' || params.get('auth') === 'skip') {
      return { user: devUser(), denied: false };
    }
  }

  try {
    const res = await fetch('/api/portal/auth/me', {
      credentials: 'same-origin',
      cache: 'no-cache',
    });
    if (!res.ok) {
      return { user: null, denied: false, error: `auth ${res.status}` };
    }
    const me = await res.json();
    if (!me?.authenticated) {
      return { user: null, denied: false };
    }
    if (!hasAccess(me)) {
      return { user: me, denied: true };
    }
    return { user: me, denied: false };
  } catch (err) {
    if (isLocalDev()) {
      return { user: devUser(), denied: false };
    }
    return { user: null, denied: false, error: String(err?.message || err) };
  }
}

export function redirectToLogin() {
  const next = location.pathname + location.search + location.hash;
  window.location.replace(
    '/admin/login?next=' + encodeURIComponent(next || LOGIN_FALLBACK),
  );
}

export function hasAccess(me) {
  if (!me) return false;
  if (me.is_portal_admin) return true;
  const grants = Array.isArray(me.grants) ? me.grants : [];
  return grants.some((g) => (g.app_id || g.id) === APP_ID);
}

export function displayName(me) {
  return (me?.display_name || me?.username || 'Player').trim();
}

function devUser() {
  return {
    authenticated: true,
    user_id: 'dev-local',
    username: 'dev',
    display_name: 'Local Dev',
    is_portal_admin: true,
    grants: [{ app_id: APP_ID, role: 'admin' }],
  };
}

function isLocalDev() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
}
