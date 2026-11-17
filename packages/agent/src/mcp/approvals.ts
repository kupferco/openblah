import { randomUUID } from "node:crypto";

export const APPROVAL_TTL_MS = 2 * 60_000;
/** Client -> agent: the owner tapped confirm or cancel. The sender identity is the LiveKit identity. */
export const APPROVAL_RESPONSE_TOPIC = "openblah.approval.response";
/** Server -> agent: decision forwarded from `POST /v1/rooms/:id/approvals/:approvalId`. */
export const APPROVAL_DECISION_TOPIC = "openblah.approval.decision";
/** Agent -> clients: a write action waits for confirmation (and later, how it ended). */
export const APPROVAL_REQUEST_TOPIC = "openblah.approval";

/** A write action waiting for its owner. */
export interface PendingApproval {
  id: string;
  ownerId: string;
  /** What is read back and shown, e.g. "book table: party=4, time=19:30". */
  summary: string;
  tool: string;
  createdAt: number;
  expiresAt: number;
  /** User speech turns seen when this was created; a spoken yes must come after. */
  turnsAtCreation: number;
  /** Run the action. Only called after a valid confirmation. Returns the text to say. */
  execute(evidence: { via: "voice" | "tap"; by: string }): Promise<string>;
  /** Called when the owner declines, the wrong person tries, or the request expires. */
  reject(status: "declined" | "denied", actor: string, reason: string): Promise<void> | void;
}

export type DecisionOutcome =
  | { status: "executed"; text: string }
  | { status: "declined"; text: string }
  | { status: "not_owner" | "unknown" | "expired" | "not_confirmed"; text: string };

export interface DecideInput {
  approvalId: string;
  actor: string;
  approve: boolean;
  via: "voice" | "tap";
  /** Current number of user speech turns. Required for voice. */
  userTurns?: number;
}

/**
 * Pending write actions of one room. A write runs only when the owner of the
 * credentials approves it; everyone else is rejected and the action stays
 * pending (or lapses after the TTL).
 */
export class ToolApprovals {
  private readonly pending = new Map<string, PendingApproval>();
  constructor(
    private readonly opts: {
      ttlMs?: number;
      now?: () => number;
      newId?: () => string;
      onResolved?: (id: string, status: "executed" | "declined" | "expired") => void;
    } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  create(p: Omit<PendingApproval, "id" | "createdAt" | "expiresAt">): PendingApproval {
    const createdAt = this.now();
    const full: PendingApproval = {
      ...p,
      id: (this.opts.newId ?? randomUUID)(),
      createdAt,
      expiresAt: createdAt + (this.opts.ttlMs ?? APPROVAL_TTL_MS),
    };
    this.pending.set(full.id, full);
    return full;
  }

  /** The newest pending action owned by `ownerId`. */
  latestFor(ownerId: string): PendingApproval | undefined {
    return [...this.pending.values()].filter((p) => p.ownerId === ownerId).at(-1);
  }

  latestAny(): PendingApproval | undefined {
    return [...this.pending.values()].at(-1);
  }

  get size(): number {
    return this.pending.size;
  }

  async decide(input: DecideInput): Promise<DecisionOutcome> {
    const p = this.pending.get(input.approvalId);
    if (!p) return { status: "unknown", text: "There is nothing waiting for confirmation." };
    if (this.now() > p.expiresAt) {
      this.pending.delete(p.id);
      await p.reject("declined", input.actor, "confirmation timed out");
      this.opts.onResolved?.(p.id, "expired");
      return { status: "expired", text: "That request timed out, so it was not done." };
    }
    if (input.actor !== p.ownerId) {
      await p.reject(
        "denied",
        input.actor,
        "confirmation from someone who does not own the account",
      );
      return {
        status: "not_owner",
        text: "Only the person whose account it is can confirm that.",
      };
    }
    if (input.via === "voice" && (input.userTurns ?? 0) <= p.turnsAtCreation) {
      // The model must not confirm on its own: the owner has to have spoken since the read-back.
      return {
        status: "not_confirmed",
        text: "Ask the person to confirm first and wait for their answer.",
      };
    }
    this.pending.delete(p.id);
    if (!input.approve) {
      await p.reject("declined", input.actor, "owner declined");
      this.opts.onResolved?.(p.id, "declined");
      return { status: "declined", text: "Okay, I will not do that." };
    }
    const text = await p.execute({ via: input.via, by: input.actor });
    this.opts.onResolved?.(p.id, "executed");
    return { status: "executed", text };
  }
}
