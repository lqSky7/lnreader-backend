import { z } from "zod";

export const syncPayloadSchema = z.object({
  profile: z.object({
    username: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    name: z.string().min(1).optional().nullable(),
    image: z.string().optional().nullable(),
  }).default({}),
  library: z.array(z.record(z.string(), z.unknown())).default([]),
  sources: z.array(z.record(z.string(), z.unknown())).default([]),
  /**
   * Optional client timestamp (ISO 8601) of the data being uploaded, used for
   * conflict detection. The server compares it against the stored `updatedAt`:
   * if the client's copy is older (beyond clock-skew tolerance), the write is
   * rejected with HTTP 409 and the current server copy, so a stale device
   * can't silently clobber a newer one. Omit for legacy last-write-wins.
   */
  clientUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

/** Clock-skew tolerance for conflict comparison (ms). */
export const CONFLICT_SKEW_TOLERANCE_MS = 5_000;

export function isStaleWrite(clientUpdatedAt: string | undefined, serverUpdatedAt: Date): boolean {
  if (!clientUpdatedAt) return false;
  const clientTime = new Date(clientUpdatedAt).getTime();
  if (Number.isNaN(clientTime)) return false;
  return clientTime + CONFLICT_SKEW_TOLERANCE_MS < serverUpdatedAt.getTime();
}
