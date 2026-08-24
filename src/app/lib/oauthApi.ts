// OAuth (SSO) sign-in — Keycloak. The dashboard auth is cookieless, so the
// server runs the Authorization Code flow and establishes the session cookie
// directly on a successful callback (see server/app.js).

import type { UserRole } from './usersApi';

export interface OAuthUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
}

// Whether Keycloak sign-in is configured + enabled. Drives the sign-in button
// on the login page.
export interface EnabledOAuthProviders {
  keycloak: boolean;
  keycloakLabel: string;
}

// Admin-facing config shape for the Settings → Sign-in form. The client secret
// is never returned — only whether one is stored. `authority` is the Keycloak
// server base URL; `realm` is the Keycloak realm — combined to derive the
// OIDC endpoints below.
export interface OAuthSettings {
  enabled: boolean;
  clientId: string;
  authority: string;
  realm: string;
  allowedDomains: string[];
  hasClientSecret: boolean;
  displayName: string;
  // Full redirect URI pre-registered with the client. Used verbatim so the
  // correct URL is sent even behind a TLS-terminating proxy.
  redirectUri: string;
  // Explicit endpoint URLs. When set, used verbatim instead of deriving from
  // authority + realm (useful when an instance uses non-standard paths).
  authorizeEndpoint: string;
  tokenEndpoint: string;
  logoutEndpoint: string;
  metadataUrl: string;
  jwksUri: string;
}

export interface OAuthSettingsInput {
  enabled: boolean;
  clientId: string;
  authority: string;
  realm: string;
  // Blank means "keep the stored secret"; a value replaces it.
  clientSecret: string;
  allowedDomains: string[];
  displayName: string;
  redirectUri: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  logoutEndpoint: string;
  metadataUrl: string;
  jwksUri: string;
}

interface MutationResult {
  ok: boolean;
  error?: string;
}

async function readError(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error;
  } catch {
    return undefined;
  }
}

// Whether to show the "Sign in with Keycloak" button on the login page.
export async function fetchEnabledOAuthProviders(): Promise<EnabledOAuthProviders> {
  try {
    const response = await fetch('/api/auth/providers', { cache: 'no-store' });
    if (!response.ok) {
      return { keycloak: false, keycloakLabel: '' };
    }
    const data = (await response.json()) as Partial<EnabledOAuthProviders>;
    return {
      keycloak: Boolean(data.keycloak),
      keycloakLabel: typeof data.keycloakLabel === 'string' ? data.keycloakLabel : '',
    };
  } catch {
    return { keycloak: false, keycloakLabel: '' };
  }
}

// Verify the grant token carried back from the OAuth callback. Deprecated —
// the callback now establishes the session cookie directly, so nothing mints
// a token for this to verify; retained for backward compatibility.
export async function verifyOAuthGrant(token: string): Promise<OAuthUser | null> {
  try {
    const response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { user?: OAuthUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

// Admin config read (Settings → Sign-in → Keycloak).
export async function fetchOAuthSettings(): Promise<OAuthSettings> {
  const response = await fetch('/api/settings/oauth/keycloak', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error((await readError(response)) ?? 'Unable to load sign-in settings.');
  }
  return response.json() as Promise<OAuthSettings>;
}

export async function saveOAuthSettings(input: OAuthSettingsInput): Promise<OAuthSettings> {
  const response = await fetch('/api/settings/oauth/keycloak', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error((await readError(response)) ?? 'Unable to save sign-in settings.');
  }
  return response.json() as Promise<OAuthSettings>;
}

export type { MutationResult };
