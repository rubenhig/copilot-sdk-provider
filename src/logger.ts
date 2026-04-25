/**
 * Logger for the Copilot AI provider.
 */
import type { CopilotLogger } from './types.js';

const NOOP = () => {};

/** Silent logger (default when verbose is false). */
export const silentLogger: CopilotLogger = {
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

/** Console logger (used when verbose is true). */
export const consoleLogger: CopilotLogger = {
  debug: (...args) => console.debug('[copilot-provider]', ...args),
  info: (...args) => console.info('[copilot-provider]', ...args),
  warn: (...args) => console.warn('[copilot-provider]', ...args),
  error: (...args) => console.error('[copilot-provider]', ...args),
};

/** Get the appropriate logger based on settings. */
export function getLogger(verbose?: boolean, custom?: CopilotLogger): CopilotLogger {
  if (custom) return custom;
  return verbose ? consoleLogger : silentLogger;
}
