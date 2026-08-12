import {
  createHash,
  randomBytes as secureRandomBytes,
} from 'node:crypto';
import type {
  OAuthProviderConfig,
} from '../config';
import type {
  CandidateStore,
  OAuthCapability,
  OAuthConnectionInput,
  StoredOAuthConnection,
} from '../data/candidateStore';
import { OAUTH_PLATFORMS, type OAuthPlatform } from './oauthTypes';

const AUTHORIZATION_TTL_MS = 10 * 60 * 1_000;

export interface StartedOAuthAuthorization {
  platform: OAuthPlatform;
  authorizationUrl: string;
  expiresAt: string;
}

export type CandidateConnectionView = {
  platform: OAuthPlatform;
  available: boolean;
  capabilities: OAuthCapability[];
  importsCareerHistory: boolean;
} & (
  | { status: 'disconnected' }
  | {
      status: 'connected';
      scopes: string[];
      accessTokenExpiresAt: string | null;
      connectedAt: string;
      profile: StoredOAuthConnection['profile'];
    }
);

export interface OAuthTransport {
  connect(input: {
    platform: OAuthPlatform;
    provider: OAuthProviderConfig;
    code: string;
    codeVerifier: string;
  }): Promise<OAuthConnectionInput>;
  /**
   * Optional: only platforms with a documented official revocation endpoint
   * implement this. Everything else reports `unsupported` instead of claiming
   * an upstream revocation that never happened.
   */
  revoke?(input: {
    platform: OAuthPlatform;
    provider: OAuthProviderConfig;
    accessToken: string;
  }): Promise<void>;
}

export interface OAuthDisconnectResult {
  platform: OAuthPlatform;
  status: 'disconnected';
  localDataRemoved: boolean;
  upstreamRevocation: 'revoked' | 'failed' | 'unsupported';
}

export class OAuthConnectorError extends Error {
  constructor(
    readonly code:
      | 'connector_not_configured'
      | 'oauth_state_invalid'
      | 'provider_oauth_failed'
      | 'provider_profile_unavailable',
    readonly statusCode: 409 | 502 | 503,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export class CandidateOAuthService {
  private readonly store: CandidateStore;
  private readonly providers: Partial<
    Record<OAuthPlatform, OAuthProviderConfig>
  >;
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly transport: OAuthTransport;

  constructor(options: {
    store: CandidateStore;
    providers: Partial<Record<OAuthPlatform, OAuthProviderConfig>>;
    now?: () => Date;
    randomBytes?: (size: number) => Buffer;
    transport?: OAuthTransport;
  }) {
    this.store = options.store;
    this.providers = options.providers;
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? secureRandomBytes;
    this.transport =
      options.transport ??
      ({
        async connect() {
          throw new OAuthConnectorError(
            'provider_oauth_failed',
            502,
            true,
          );
        },
      } satisfies OAuthTransport);
  }

  startAuthorization(
    candidateId: string,
    platform: OAuthPlatform,
  ): StartedOAuthAuthorization {
    const provider = this.requireProvider(platform);
    const state = this.randomBytes(32).toString('base64url');
    const codeVerifier = this.randomBytes(48).toString('base64url');
    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + AUTHORIZATION_TTL_MS,
    ).toISOString();
    this.store.createOAuthAuthorization(candidateId, {
      platform,
      stateDigest: sha256Hex(state),
      codeVerifier,
      expiresAt,
    });

    return {
      platform,
      authorizationUrl: buildAuthorizationUrl(
        platform,
        provider,
        state,
        codeVerifier,
      ),
      expiresAt,
    };
  }

  listConnections(candidateId: string): CandidateConnectionView[] {
    const connected = new Map(
      this.store
        .listOAuthConnections(candidateId)
        .map((connection) => [connection.platform, connection]),
    );
    return OAUTH_PLATFORMS.map((platform) => {
      const connection = connected.get(platform);
      const catalog = providerCapabilities(platform);
      if (!connection) {
        return {
          platform,
          available: Boolean(this.providers[platform]),
          status: 'disconnected' as const,
          ...catalog,
        };
      }
      return {
        platform,
        available: Boolean(this.providers[platform]),
        status: 'connected' as const,
        ...catalog,
        scopes: [...connection.scopes],
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        connectedAt: connection.connectedAt,
        profile: connection.profile,
      };
    });
  }

  async completeAuthorization(
    platform: OAuthPlatform,
    callback: { state: string; code: string },
  ): Promise<CandidateConnectionView> {
    const provider = this.requireProvider(platform);
    if (
      !/^[A-Za-z0-9_-]{32,256}$/.test(callback.state) ||
      callback.code.length < 8 ||
      callback.code.length > 2_048 ||
      // eslint-disable-next-line no-control-regex -- OAuth codes must reject ASCII controls.
      /[\u0000-\u001f\u007f]/u.test(callback.code)
    ) {
      throw new OAuthConnectorError('oauth_state_invalid', 409, false);
    }
    const authorization = this.store.consumeOAuthAuthorization(
      platform,
      sha256Hex(callback.state),
      this.now().toISOString(),
    );
    if (!authorization) {
      throw new OAuthConnectorError('oauth_state_invalid', 409, false);
    }
    let connection: OAuthConnectionInput;
    try {
      connection = await this.transport.connect({
        platform,
        provider,
        code: callback.code,
        codeVerifier: authorization.codeVerifier,
      });
    } catch (error) {
      if (error instanceof OAuthConnectorError) throw error;
      throw new OAuthConnectorError('provider_oauth_failed', 502, true);
    }
    if (connection.platform !== platform) {
      throw new OAuthConnectorError(
        'provider_profile_unavailable',
        502,
        false,
      );
    }
    const stored = this.store.saveOAuthConnection(
      authorization.candidateId,
      connection,
    );
    return connectedView(stored, Boolean(this.providers[platform]));
  }

  declineAuthorization(platform: OAuthPlatform, state: string): void {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) return;
    this.store.consumeOAuthAuthorization(
      platform,
      sha256Hex(state),
      this.now().toISOString(),
    );
  }

  async disconnect(
    candidateId: string,
    platform: OAuthPlatform,
  ): Promise<OAuthDisconnectResult> {
    const connection = this.store.getOAuthConnection(candidateId, platform);
    const provider = this.providers[platform];
    const revoke = this.transport.revoke;
    let upstreamRevocation: OAuthDisconnectResult['upstreamRevocation'] =
      'unsupported';
    if (connection && provider && revoke) {
      try {
        await revoke.call(this.transport, {
          platform,
          provider,
          accessToken: connection.accessToken,
        });
        upstreamRevocation = 'revoked';
      } catch {
        upstreamRevocation = 'failed';
      }
    }
    return {
      platform,
      status: 'disconnected',
      localDataRemoved: this.store.deleteOAuthConnection(candidateId, platform),
      upstreamRevocation,
    };
  }

  private requireProvider(platform: OAuthPlatform): OAuthProviderConfig {
    const provider = this.providers[platform];
    if (!provider) {
      throw new OAuthConnectorError(
        'connector_not_configured',
        503,
        false,
      );
    }
    return provider;
  }
}

function providerCapabilities(platform: OAuthPlatform): {
  capabilities: OAuthCapability[];
  importsCareerHistory: boolean;
} {
  return platform === 'linkedin'
    ? { capabilities: ['lite_identity'], importsCareerHistory: false }
    : {
        capabilities: ['profile_read', 'resume_read'],
        importsCareerHistory: true,
      };
}

function connectedView(
  connection: StoredOAuthConnection,
  available: boolean,
): CandidateConnectionView {
  return {
    platform: connection.platform,
    available,
    status: 'connected',
    ...providerCapabilities(connection.platform),
    scopes: [...connection.scopes],
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    connectedAt: connection.connectedAt,
    profile: connection.profile,
  };
}

function buildAuthorizationUrl(
  platform: OAuthPlatform,
  provider: OAuthProviderConfig,
  state: string,
  codeVerifier: string,
): string {
  const url = new URL(
    platform === 'linkedin'
      ? 'https://www.linkedin.com/oauth/v2/authorization'
      : 'https://hh.ru/oauth/authorize',
  );
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', provider.redirectUri);
  url.searchParams.set('state', state);
  if (platform === 'linkedin') {
    url.searchParams.set('scope', 'openid profile email');
  } else {
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(codeVerifier).digest('base64url'),
    );
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('role', 'applicant');
    url.searchParams.set('force_role', 'true');
  }
  return url.toString();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
