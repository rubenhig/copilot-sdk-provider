/**
 * Error helpers for the Copilot AI provider.
 */

/**
 * Create an authentication error (missing or invalid GITHUB_TOKEN).
 */
export function createAuthError(message: string): Error {
  const error = new Error(message);
  error.name = 'CopilotAuthError';
  return error;
}

/**
 * Create a timeout error for sendAndWait exceeding the limit.
 */
export function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(
    `Copilot session timed out after ${timeoutMs}ms. ` +
    `Increase maxTurnTimeout in settings if the agent needs more time.`
  );
  error.name = 'CopilotTimeoutError';
  return error;
}

/**
 * Create a generic API/SDK error.
 */
export function createSDKError(message: string, cause?: unknown): Error {
  const error = new Error(message, { cause });
  error.name = 'CopilotSDKError';
  return error;
}

/** Check if an error is an authentication error. */
export function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'CopilotAuthError') return true;
    const msg = error.message.toLowerCase();
    return msg.includes('github_token') ||
           msg.includes('unauthorized') ||
           msg.includes('authentication') ||
           msg.includes('401');
  }
  return false;
}

/** Check if an error is a timeout error. */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'CopilotTimeoutError') return true;
    return error.message.includes('timed out') ||
           error.message.includes('timeout');
  }
  return false;
}

/** Check if an error is retryable. */
export function isRetryableError(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('econnrefused') ||
           msg.includes('econnreset') ||
           msg.includes('etimedout') ||
           msg.includes('enoent');
  }
  return false;
}
