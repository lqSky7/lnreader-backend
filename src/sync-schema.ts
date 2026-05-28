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
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;
