import { logAuditEvent } from './auditApi';

// Admin override for the site's own public origin (Settings → Sign-in). Used as
// the top-priority tier when the server builds the OAuth redirect_uri — see
// resolvePublicOrigin() in server/app.js. Backed by the app_settings key
// `sso_public_url`.
export interface SsoPublicUrlSetting {
  publicUrl: string;
  // The current APP_BASE_URL env var, read-only — the fallback tier used when
  // publicUrl is blank. Shown in the UI as a hint.
  envFallback: string;
}

async function parseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

export async function fetchSsoPublicUrl(): Promise<SsoPublicUrlSetting> {
  const response = await fetch('/api/settings/sso-public-url', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<SsoPublicUrlSetting>;
}

export async function saveSsoPublicUrl(publicUrl: string): Promise<SsoPublicUrlSetting> {
  const response = await fetch('/api/settings/sso-public-url', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicUrl }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  logAuditEvent('settings.sso-public-url', undefined, { publicUrl });
  return response.json() as Promise<SsoPublicUrlSetting>;
}
