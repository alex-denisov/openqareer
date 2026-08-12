import type { DatabaseSync } from 'node:sqlite';
import {
  pauseInterruptedConnectorAction,
  type ConnectorActionRecord,
} from '../connectors/connectorActionQueue';
import type {
  CareerCommandRecord,
  VerifiedCareerApproval,
} from '../orchestration/careerCommandPlanner';
import type { SealedText } from './sealedText';

interface CareerCommandRow {
  command_cipher: string;
  payload_digest: string;
  status: CareerCommandRecord['status'];
}

export class SqliteCareerCommandRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(command: CareerCommandRecord): CareerCommandRecord {
    const existing = this.get(command.candidateId, command.commandId);
    if (existing) {
      if (existing.idempotency.payloadDigest !== command.idempotency.payloadDigest) {
        throw new CareerCommandConflictError();
      }
      return existing;
    }
    this.database
      .prepare(
        `INSERT INTO career_commands
          (candidate_id, command_id, capability, payload_digest, status,
           command_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        command.candidateId,
        command.commandId,
        command.capability,
        command.idempotency.payloadDigest,
        command.status,
        this.seal(command),
        command.createdAt,
        command.updatedAt,
      );
    return command;
  }

  get(candidateId: string, commandId: string): CareerCommandRecord | null {
    const row = this.database
      .prepare(
        `SELECT command_cipher, payload_digest, status
         FROM career_commands WHERE candidate_id = ? AND command_id = ?`,
      )
      .get(candidateId, commandId) as CareerCommandRow | undefined;
    if (!row) return null;
    const command = JSON.parse(
      this.sealedText.open(
        row.command_cipher,
        associatedData(candidateId, commandId),
      ),
    ) as CareerCommandRecord;
    if (
      command.candidateId !== candidateId ||
      command.commandId !== commandId ||
      command.status !== row.status ||
      command.idempotency.payloadDigest !== row.payload_digest
    ) {
      throw new CareerCommandConflictError();
    }
    return command;
  }

  list(candidateId: string): CareerCommandRecord[] {
    const rows = this.database
      .prepare(
        `SELECT command_id FROM career_commands
         WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .all(candidateId) as Array<{ command_id: string }>;
    return rows.map((row) => {
      const command = this.get(candidateId, row.command_id);
      if (!command) throw new CareerCommandConflictError();
      return command;
    });
  }

  approve(input: {
    candidateId: string;
    commandId: string;
    approval: VerifiedCareerApproval;
    consumedAt: string;
  }): CareerCommandRecord {
    const command = this.get(input.candidateId, input.commandId);
    if (!command) throw new CareerCommandNotFoundError();
    const approval = input.approval;
    if (
      approval.candidateId !== input.candidateId ||
      approval.commandId !== input.commandId ||
      approval.capability !== command.capability ||
      Date.parse(approval.expiresAt) <= Date.parse(input.consumedAt)
    ) {
      throw new CareerCommandApprovalError();
    }
    const existing = this.existingApproval(approval.id);
    if (existing) {
      if (
        existing.candidate_id !== input.candidateId ||
        existing.command_id !== input.commandId ||
        existing.capability !== command.capability
      ) {
        throw new CareerCommandConflictError();
      }
      return command;
    }
    if (command.status !== 'awaiting_approval') {
      throw new CareerCommandConflictError();
    }
    return this.queue(command, input);
  }

  private existingApproval(approvalId: string):
    | { candidate_id: string; command_id: string; capability: string }
    | undefined {
    return this.database
      .prepare(
        `SELECT candidate_id, command_id, capability
         FROM career_command_approvals WHERE approval_id = ?`,
      )
      .get(approvalId) as
      | { candidate_id: string; command_id: string; capability: string }
      | undefined;
  }

  private queue(
    command: CareerCommandRecord,
    input: {
      candidateId: string;
      commandId: string;
      approval: VerifiedCareerApproval;
      consumedAt: string;
    },
  ): CareerCommandRecord {
    const approval = input.approval;
    const queued: CareerCommandRecord = {
      ...command,
      status: 'queued',
      authorization: { approvalId: approval.id },
      updatedAt: input.consumedAt,
    };
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO career_command_approvals
            (approval_id, candidate_id, command_id, capability, expires_at,
             consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          approval.id,
          input.candidateId,
          input.commandId,
          command.capability,
          approval.expiresAt,
          input.consumedAt,
          input.consumedAt,
        );
      this.write(queued);
      this.database
        .prepare(
          `INSERT INTO career_command_outbox
            (candidate_id, command_id, status, attempts, created_at, updated_at)
           VALUES (?, ?, 'pending', 0, ?, ?)`,
        )
        .run(
          input.candidateId,
          input.commandId,
          input.consumedAt,
          input.consumedAt,
        );
    });
    return queued;
  }

  claim(
    candidateId: string,
    commandId: string,
    execution: ConnectorActionRecord,
    claimedAt: string,
  ): CareerCommandRecord {
    const command = this.get(candidateId, commandId);
    if (!command) throw new CareerCommandNotFoundError();
    if (command.status !== 'queued') throw new CareerCommandConflictError();
    const executing: CareerCommandRecord = {
      ...command,
      status: 'executing',
      execution,
      updatedAt: claimedAt,
    };
    this.transaction(() => {
      this.write(executing);
      const result = this.database
        .prepare(
          `UPDATE career_command_outbox
           SET status = 'processing', attempts = attempts + 1, updated_at = ?
           WHERE candidate_id = ? AND command_id = ? AND status = 'pending'`,
        )
        .run(claimedAt, candidateId, commandId);
      if (result.changes !== 1) throw new CareerCommandConflictError();
    });
    return executing;
  }

  finish(
    candidateId: string,
    commandId: string,
    command: CareerCommandRecord,
  ): CareerCommandRecord {
    const current = this.get(candidateId, commandId);
    if (
      !current ||
      current.status !== 'executing' ||
      command.candidateId !== candidateId ||
      command.commandId !== commandId ||
      !['completed_with_receipt', 'paused', 'failed', 'native_handoff'].includes(
        command.status,
      )
    ) {
      throw new CareerCommandConflictError();
    }
    this.transaction(() => {
      this.write(command);
      const result = this.database
        .prepare(
          `UPDATE career_command_outbox
           SET status = 'delivered', updated_at = ?
           WHERE candidate_id = ? AND command_id = ? AND status = 'processing'`,
        )
        .run(command.updatedAt, candidateId, commandId);
      if (result.changes !== 1) throw new CareerCommandConflictError();
    });
    return command;
  }

  recoverInterruptedProcessing(recoveredAt: string): number {
    const rows = this.database
      .prepare(
        `SELECT candidate_id, command_id
         FROM career_command_outbox WHERE status = 'processing'`,
      )
      .all() as Array<{ candidate_id: string; command_id: string }>;
    if (!rows.length) return 0;
    this.transaction(() => {
      for (const row of rows) {
        const command = this.get(row.candidate_id, row.command_id);
        if (command?.status !== 'executing' || !command.execution) {
          throw new CareerCommandConflictError();
        }
        const paused: CareerCommandRecord = {
          ...command,
          status: 'paused',
          execution: pauseInterruptedConnectorAction(
            command.execution,
            recoveredAt,
          ),
          updatedAt: recoveredAt,
        };
        this.write(paused);
        const result = this.database
          .prepare(
            `UPDATE career_command_outbox
             SET status = 'delivered', updated_at = ?
             WHERE candidate_id = ? AND command_id = ? AND status = 'processing'`,
          )
          .run(recoveredAt, row.candidate_id, row.command_id);
        if (result.changes !== 1) throw new CareerCommandConflictError();
      }
    });
    return rows.length;
  }

  private seal(command: CareerCommandRecord): string {
    return this.sealedText.seal(
      JSON.stringify(command),
      associatedData(command.candidateId, command.commandId),
    );
  }

  private write(command: CareerCommandRecord): void {
    const result = this.database
      .prepare(
        `UPDATE career_commands
         SET status = ?, command_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND command_id = ?`,
      )
      .run(
        command.status,
        this.seal(command),
        command.updatedAt,
        command.candidateId,
        command.commandId,
      );
    if (result.changes !== 1) throw new CareerCommandNotFoundError();
  }

  private transaction<T>(operation: () => T): T {
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

export class CareerCommandNotFoundError extends Error {}
export class CareerCommandApprovalError extends Error {}
export class CareerCommandConflictError extends Error {}

function associatedData(candidateId: string, commandId: string): string {
  return `candidate:${candidateId}:career-command:${commandId}`;
}
