const HOST_DISPLAY_NAMES: Record<string, string> = {
  "api.github.com": "GitHub API",
  "api.resend.com": "Resend API",
  "api.brevo.com": "Brevo API",
  "api.emailjs.com": "EmailJS API",
  "api.sendgrid.com": "SendGrid API",
  "api.stripe.com": "Stripe API",
  "api.twilio.com": "Twilio API",
  "api.openai.com": "OpenAI API",
  "slack.com": "Slack",
};

export function integrationDisplayName(canonicalName: string): string {
  const host = canonicalName.toLowerCase();
  return HOST_DISPLAY_NAMES[host] ?? canonicalName;
}

export function integrationLabel(canonicalName: string): string {
  const display = integrationDisplayName(canonicalName);
  if (display === canonicalName) return canonicalName;
  return `${display} (${canonicalName})`;
}
