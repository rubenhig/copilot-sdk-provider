/**
 * copilot-ai-provider
 *
 * Vercel AI SDK provider for GitHub Copilot SDK.
 * Wraps `@github/copilot-sdk` as a `LanguageModelV3` compatible provider.
 *
 * @example
 * ```typescript
 * import { copilot } from 'copilot-ai-provider';
 * import { streamText } from 'ai';
 *
 * const result = await streamText({
 *   model: copilot('default', { cwd: '/my/repo' }),
 *   prompt: 'Explain the authentication flow in this codebase',
 * });
 * ```
 */

// Provider factory
export { createCopilot, copilot } from './copilot-provider.js';
export type { CopilotProvider, CopilotProviderOptions } from './copilot-provider.js';

// Language model
export { CopilotLanguageModel } from './copilot-language-model.js';

// Types
export type {
  CopilotSettings,
  CopilotModelId,
  CopilotLogger,
} from './types.js';

// Utilities
export { convertMessages, extractLastUserMessage } from './convert-messages.js';
export type { ConvertedMessages } from './convert-messages.js';
export { mapFinishReason } from './map-finish-reason.js';

// Errors
export {
  createAuthError,
  createTimeoutError,
  createSDKError,
  isAuthError,
  isTimeoutError,
  isRetryableError,
} from './errors.js';

// Logger
export { getLogger, consoleLogger, silentLogger } from './logger.js';
