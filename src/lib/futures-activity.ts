import type { Prisma } from "@prisma/client";

export type FuturesActivityAction =
  | "POSITION_OPENED"
  | "POSITION_ADJUSTED"
  | "AUTOMATION_CHANGED"
  | "JOURNAL_UPDATED"
  | "POSITION_PARTIALLY_CLOSED"
  | "POSITION_CLOSED"
  | "CLOSED_TRADE_EDITED"
  | "CLOSED_TRADE_DELETED";

type ActivityWriter = Pick<Prisma.TransactionClient, "futuresActivity">;

export async function recordFuturesActivity(
  db: ActivityWriter,
  input: {
    userId: number;
    positionId: number;
    asset: string;
    side: string;
    action: FuturesActivityAction;
    summary: string;
    details?: Record<string, string | number | boolean | null>;
  },
) {
  return db.futuresActivity.create({
    data: {
      userId: input.userId,
      positionId: input.positionId,
      asset: input.asset,
      side: input.side,
      action: input.action,
      summary: input.summary,
      details: JSON.stringify(input.details ?? {}),
    },
  });
}
