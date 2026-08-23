import type { DatabaseSync } from 'node:sqlite';
import type {
  ConsumedOAuthAuthorization,
  OAuthAuthorizationInput,
  OAuthConnectionInput,
  StoredOAuthConnection,
} from '../candidateStore';
import type { OAuthPlatform } from '../../connectors/oauthTypes';
import type { SealedText } from '../sealedText';
import {
  oauthAuthorizationAssociatedData,
  oauthConnectionAssociatedData,
  type StoreContext,
} from './shared';

export class OAuthController {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(deps: StoreContext) {
    this.database = deps.database;
    this.sealedText = deps.sealedText;
  }

  createOAuthAuthorization(
    candidateId: string,
    authorization: OAuthAuthorizationInput,
  ): void {
    if (!/^[a-f0-9]{64}$/.test(authorization.stateDigest)) {
      throw new Error('OAuth state digest must be lowercase SHA-256 hex');
    }
    const now = new Date().toISOString();
    this.inTransaction(() => {
      this.database
        .prepare(
          `DELETE FROM oauth_authorizations
           WHERE expires_at <= ? OR (candidate_id = ? AND platform = ?)`,
        )
        .run(now, candidateId, authorization.platform);
      this.database
        .prepare(
          `INSERT INTO oauth_authorizations
            (state_digest, candidate_id, platform, code_verifier_cipher,
             expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          authorization.stateDigest,
          candidateId,
          authorization.platform,
          this.sealedText.seal(
            authorization.codeVerifier,
            oauthAuthorizationAssociatedData(
              candidateId,
              authorization.platform,
              authorization.stateDigest,
            ),
          ),
          authorization.expiresAt,
          now,
        );
    });
  }

  consumeOAuthAuthorization(
    platform: OAuthPlatform,
    stateDigest: string,
    consumedAt: string,
  ): ConsumedOAuthAuthorization | null {
    let consumed: ConsumedOAuthAuthorization | null = null;
    this.inTransaction(() => {
      const row = this.database
        .prepare(
          `SELECT candidate_id, code_verifier_cipher, expires_at
           FROM oauth_authorizations
           WHERE state_digest = ? AND platform = ?`,
        )
        .get(stateDigest, platform) as
        | {
            candidate_id: string;
            code_verifier_cipher: string;
            expires_at: string;
          }
        | undefined;
      this.database
        .prepare('DELETE FROM oauth_authorizations WHERE state_digest = ?')
        .run(stateDigest);
      if (!row || row.expires_at <= consumedAt) return;
      consumed = {
        candidateId: row.candidate_id,
        codeVerifier: this.sealedText.open(
          row.code_verifier_cipher,
          oauthAuthorizationAssociatedData(
            row.candidate_id,
            platform,
            stateDigest,
          ),
        ),
      };
    });
    return consumed;
  }

  saveOAuthConnection(
    candidateId: string,
    connection: OAuthConnectionInput,
  ): StoredOAuthConnection {
    const existing = this.getOAuthConnection(candidateId, connection.platform);
    const now = new Date().toISOString();
    const stored: StoredOAuthConnection = {
      ...connection,
      capabilities: [...connection.capabilities],
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };
    const cipher = this.sealedText.seal(
      JSON.stringify(stored),
      oauthConnectionAssociatedData(candidateId, connection.platform),
    );
    this.database
      .prepare(
        `INSERT INTO oauth_connections
          (candidate_id, platform, connection_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, platform) DO UPDATE SET
           connection_cipher = excluded.connection_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        connection.platform,
        cipher,
        stored.connectedAt,
        stored.updatedAt,
      );
    return stored;
  }

  getOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): StoredOAuthConnection | null {
    const row = this.database
      .prepare(
        `SELECT connection_cipher FROM oauth_connections
         WHERE candidate_id = ? AND platform = ?`,
      )
      .get(candidateId, platform) as { connection_cipher: string } | undefined;
    if (!row) return null;
    return JSON.parse(
      this.sealedText.open(
        row.connection_cipher,
        oauthConnectionAssociatedData(candidateId, platform),
      ),
    ) as StoredOAuthConnection;
  }

  listOAuthConnections(candidateId: string): StoredOAuthConnection[] {
    const rows = this.database
      .prepare(
        `SELECT platform, connection_cipher FROM oauth_connections
         WHERE candidate_id = ? ORDER BY platform`,
      )
      .all(candidateId) as Array<{
      platform: OAuthPlatform;
      connection_cipher: string;
    }>;
    return rows.map((row) =>
      JSON.parse(
        this.sealedText.open(
          row.connection_cipher,
          oauthConnectionAssociatedData(candidateId, row.platform),
        ),
      ) as StoredOAuthConnection,
    );
  }

  deleteOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): boolean {
    return (
      this.database
        .prepare(
          `DELETE FROM oauth_connections
           WHERE candidate_id = ? AND platform = ?`,
        )
        .run(candidateId, platform).changes === 1
    );
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
