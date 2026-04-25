/**
 * Map Copilot SDK finish signals to Vercel AI SDK LanguageModelV3 finish reasons.
 */
import type { LanguageModelV3FinishReason } from '@ai-sdk/provider';

/**
 * Determine the finish reason from the SDK response.
 *
 * The Copilot SDK's `sendAndWait()` resolves with:
 * - `AssistantMessageEvent` (success, data.content has the response)
 * - `undefined` (no assistant response received)
 *
 * There's no explicit "finish reason" in the SDK API, so we infer:
 * - Normal completion → 'stop'
 * - Timeout → 'other' (session timeout, not token limit)
 * - Error → 'error'
 * - Undefined/no response → 'stop' (empty response is still a completion)
 */
export function mapFinishReason(
  completed: boolean,
  timedOut: boolean,
  errored: boolean,
): LanguageModelV3FinishReason {
  if (errored) {
    return { unified: 'error', raw: 'error' };
  }
   if (timedOut) {
    return { unified: 'other', raw: 'timeout' };
  }
  return { unified: 'stop', raw: completed ? 'completed' : 'empty' };
}
