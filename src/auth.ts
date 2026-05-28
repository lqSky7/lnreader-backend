import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { sendPasswordResetEmail } from "./email.js";

export const auth = betterAuth({
  appName: "LNReader",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3005",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3005",
    process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  ],
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
