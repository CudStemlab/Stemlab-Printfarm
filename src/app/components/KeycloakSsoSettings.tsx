import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from './ui/card';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { fetchOAuthSettings, saveOAuthSettings } from '../lib/oauthApi';

interface KeycloakSsoSettingsProps {
  // Only admins may change these; others see a read-only form.
  disabled?: boolean;
}

// Keycloak SSO configuration (Settings → Sign-in). Keycloak is the sole SSO
// provider — self-contained: loads its own settings on mount and saves them
// on submit. The client secret is write-only — the server returns only
// whether one is stored, so a blank field on save keeps the existing secret.
export function KeycloakSsoSettings({ disabled = false }: KeycloakSsoSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [authority, setAuthority] = useState('');
  const [realm, setRealm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [authorizeEndpoint, setAuthorizeEndpoint] = useState('');
  const [tokenEndpoint, setTokenEndpoint] = useState('');
  const [logoutEndpoint, setLogoutEndpoint] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [jwksUri, setJwksUri] = useState('');
  const [allowedDomains, setAllowedDomains] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOAuthSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setEnabled(settings.enabled);
        setClientId(settings.clientId);
        setHasSecret(settings.hasClientSecret);
        setAuthority(settings.authority);
        setRealm(settings.realm);
        setAllowedDomains(settings.allowedDomains.join('\n'));
        setDisplayName(settings.displayName);
        setRedirectUri(settings.redirectUri ?? '');
        setAuthorizeEndpoint(settings.authorizeEndpoint ?? '');
        setTokenEndpoint(settings.tokenEndpoint ?? '');
        setLogoutEndpoint(settings.logoutEndpoint ?? '');
        setMetadataUrl(settings.metadataUrl ?? '');
        setJwksUri(settings.jwksUri ?? '');
      })
      .catch(() => {
        toast.error('Unable to load Keycloak sign-in settings.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) {
      toast.error('Only admins can change sign-in settings.');
      return;
    }

    const trimmedClientId = clientId.trim();
    const trimmedAuthority = authority.trim();
    const trimmedRealm = realm.trim();
    const domains = allowedDomains
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    if (enabled) {
      if (!trimmedClientId || (!hasSecret && !clientSecret.trim())) {
        toast.error('Client ID and Client Secret are required to enable Keycloak sign-in.');
        return;
      }
      if (!trimmedAuthority) {
        toast.error('A Keycloak server URL is required to enable Keycloak sign-in.');
        return;
      }
      if (!trimmedRealm) {
        toast.error('A realm is required to enable Keycloak sign-in.');
        return;
      }
    }

    setSaving(true);
    try {
      const saved = await saveOAuthSettings({
        enabled,
        clientId: trimmedClientId,
        authority: trimmedAuthority,
        realm: trimmedRealm,
        clientSecret: clientSecret.trim(),
        allowedDomains: domains,
        displayName: displayName.trim(),
        redirectUri: redirectUri.trim(),
        authorizeEndpoint: authorizeEndpoint.trim(),
        tokenEndpoint: tokenEndpoint.trim(),
        logoutEndpoint: logoutEndpoint.trim(),
        metadataUrl: metadataUrl.trim(),
        jwksUri: jwksUri.trim(),
      });
      setEnabled(saved.enabled);
      setClientId(saved.clientId);
      setHasSecret(saved.hasClientSecret);
      setAuthority(saved.authority);
      setRealm(saved.realm);
      setAllowedDomains(saved.allowedDomains.join('\n'));
      setDisplayName(saved.displayName);
      setRedirectUri(saved.redirectUri ?? '');
      setAuthorizeEndpoint(saved.authorizeEndpoint ?? '');
      setTokenEndpoint(saved.tokenEndpoint ?? '');
      setLogoutEndpoint(saved.logoutEndpoint ?? '');
      setMetadataUrl(saved.metadataUrl ?? '');
      setJwksUri(saved.jwksUri ?? '');
      setClientSecret('');
      toast.success('Keycloak sign-in settings saved.');
    } catch (error) {
      toast.error('Unable to save Keycloak sign-in settings.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const defaultCallbackUrl = `${origin}/api/auth/keycloak/callback`;
  const endpointBase = authority.trim().replace(/\/+$/, '');
  const realmBase =
    endpointBase && realm.trim()
      ? `${endpointBase}/realms/${realm.trim()}/protocol/openid-connect`
      : 'https://keycloak.example.com/realms/printfarm/protocol/openid-connect';

  return (
    <Card className="p-6">
      <form onSubmit={handleSave} className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Keycloak sign-in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Let people sign in with a Keycloak account. Everyone who signs in
            this way gets the read-only <span className="font-medium">student</span> role.{' '}
            Create a client in the Keycloak Admin Console (realm → Clients →
            Create client, client authentication on) and add the redirect URI
            below.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="oauth-enabled-keycloak" className="text-base">
              Enable Keycloak sign-in
            </Label>
            <p className="text-sm text-muted-foreground">
              Shows a “Sign in with Keycloak” button on the login page.
            </p>
          </div>
          <Switch
            id="oauth-enabled-keycloak"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-authority-keycloak">Keycloak Server URL</Label>
          <Input
            id="oauth-authority-keycloak"
            value={authority}
            onChange={(e) => setAuthority(e.target.value)}
            placeholder="https://keycloak.example.com"
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Base URL of the Keycloak server (no trailing path, e.g.{' '}
            <code>https://keycloak.example.com</code>). Combined with the realm
            below to derive the OIDC endpoints when left blank.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-realm-keycloak">Realm</Label>
          <Input
            id="oauth-realm-keycloak"
            value={realm}
            onChange={(e) => setRealm(e.target.value)}
            placeholder="printfarm"
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            The Keycloak realm this client is registered in. Combined with the
            server URL above to derive the OIDC endpoints below (
            <code>&lt;server URL&gt;/realms/&lt;realm&gt;/protocol/openid-connect/...</code>
            ) when those fields are left blank.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-redirect-uri-keycloak">Redirect URI</Label>
          <Input
            id="oauth-redirect-uri-keycloak"
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder={defaultCallbackUrl}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            The exact redirect URI registered with the client (e.g.{' '}
            <code>{defaultCallbackUrl}</code>). Leave blank to use that default;
            override when behind a reverse proxy that needs an exact match.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-authorize-endpoint-keycloak">Authorize endpoint</Label>
          <Input
            id="oauth-authorize-endpoint-keycloak"
            value={authorizeEndpoint}
            onChange={(e) => setAuthorizeEndpoint(e.target.value)}
            placeholder={`${realmBase}/auth`}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Override the authorization endpoint. Leave blank to derive from the server URL and realm above.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-token-endpoint-keycloak">Token endpoint</Label>
          <Input
            id="oauth-token-endpoint-keycloak"
            value={tokenEndpoint}
            onChange={(e) => setTokenEndpoint(e.target.value)}
            placeholder={`${realmBase}/token`}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Override the token exchange endpoint. Leave blank to derive from the server URL and realm above.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-logout-endpoint-keycloak">Logout endpoint</Label>
          <Input
            id="oauth-logout-endpoint-keycloak"
            value={logoutEndpoint}
            onChange={(e) => setLogoutEndpoint(e.target.value)}
            placeholder={`${realmBase}/logout`}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Override the logout endpoint. Leave blank to derive from the server URL and realm above.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-metadata-url-keycloak">OIDC Metadata URL</Label>
          <Input
            id="oauth-metadata-url-keycloak"
            value={metadataUrl}
            onChange={(e) => setMetadataUrl(e.target.value)}
            placeholder={
              endpointBase && realm.trim()
                ? `${endpointBase}/realms/${realm.trim()}/.well-known/openid-configuration`
                : 'https://keycloak.example.com/realms/printfarm/.well-known/openid-configuration'
            }
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            OpenID Connect discovery document URL (informational — stored for reference).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-jwks-uri-keycloak">JWKS URI</Label>
          <Input
            id="oauth-jwks-uri-keycloak"
            value={jwksUri}
            onChange={(e) => setJwksUri(e.target.value)}
            placeholder={`${realmBase}/certs`}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            JSON Web Key Set endpoint for token signature verification.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-client-id-keycloak">Client ID</Label>
          <Input
            id="oauth-client-id-keycloak"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="printfarm-dashboard"
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-client-secret-keycloak">Client Secret</Label>
          <Input
            id="oauth-client-secret-keycloak"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={hasSecret ? '•••••••• (leave blank to keep)' : 'Enter the client secret'}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {hasSecret
              ? 'A client secret is stored. Leave blank to keep it, or enter a new one to replace it.'
              : 'No client secret stored yet.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-display-name-keycloak">Button label</Label>
          <Input
            id="oauth-display-name-keycloak"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Sign in with Keycloak"
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Text shown on the sign-in button. Leave blank to use the default
            "Sign in with Keycloak".
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="oauth-domains-keycloak">Allowed email domains</Label>
          <Textarea
            id="oauth-domains-keycloak"
            value={allowedDomains}
            onChange={(e) => setAllowedDomains(e.target.value)}
            placeholder={'school.edu\nexample.org'}
            rows={3}
            disabled={disabled}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            One domain per line (or comma-separated). Leave empty to allow any
            Keycloak account with a verified email.
          </p>
        </div>

        <Button type="submit" disabled={saving || disabled}>
          {saving ? 'Saving...' : 'Save Keycloak settings'}
        </Button>
      </form>
    </Card>
  );
}
