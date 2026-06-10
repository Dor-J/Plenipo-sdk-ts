/** Maps Core registration failures to user-facing sync warnings. */
export function syncWarningsFromError(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('status 403')) {
    return ['Core-hosted local registration is disabled on Core'];
  }
  if (message.includes('status 409')) {
    return ['Core rejected auth key rotation; previous and new key proofs are required'];
  }
  if (/status 40[01]/.test(message)) {
    return [`Core registration rejected (${message})`];
  }
  if (/status \d{3}/.test(message)) {
    return [`Core registration failed (${message})`];
  }
  if (
    message.includes('fetch failed') ||
    message.includes('ECONNREFUSED') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return ['Core unavailable'];
  }

  return ['Core registration failed'];
}
