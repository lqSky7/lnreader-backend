import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { sendPasswordResetEmail } from "./email.js";
import type { AppConfig } from "./config.js";

export function buildTrustedOrigins(config: AppConfig): string[] {
  const origins = new Set<string>();
  origins.add(config.BETTER_AUTH_URL);
  for (const o of config.clientOrigins) {
    if (o === "*") continue;
    origins.add(o);
  }
  // The iOS app opens password-reset links via a custom URL scheme and sends
  // it as `redirectTo`. Without this entry better-auth rejects every reset
  // request with INVALID_REDIRECT_URL.
  origins.add(config.PASSWORD_RESET_URL);
  return [...origins];
}

export function createAuth(config: AppConfig) {
  return betterAuth({
    appName: "LNReader",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: buildTrustedOrigins(config),
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: sendPasswordResetEmail,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
