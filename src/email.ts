type ResetPasswordPayload = {
  user: { email: string };
  url: string;
  token: string;
};

export async function sendPasswordResetEmail({ user, url, token }: ResetPasswordPayload) {
  const resetUrl = process.env.PASSWORD_RESET_URL
    ? `${process.env.PASSWORD_RESET_URL}?token=${encodeURIComponent(token)}`
    : url;

  // Replace this with SMTP/Resend/etc. before production. Keeping it explicit
  // makes local development safe and still exercises Better Auth's reset flow.
  console.info("[auth] Password reset requested", {
    to: user.email,
    resetUrl,
  });
}
