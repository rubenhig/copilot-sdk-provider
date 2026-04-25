/**
 * Convert Vercel AI SDK ModelMessage[] prompt to a string prompt for
 * the Copilot SDK's `sendAndWait({ prompt })`.
 *
 * The Copilot SDK expects a plain string prompt. Multi-turn history is
 * maintained inside the SDK session, so we only need to extract the
 * latest user message from the Vercel prompt array.
 *
 * For the first message, we also extract the system prompt (if present
 * in the Vercel messages) so it can be applied via session config.
 */

interface TextPart {
  type: 'text';
  text: string;
}

type ContentPart = TextPart | { type: string; [key: string]: unknown };

interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
}

export interface ConvertedMessages {
  /** The prompt string to send to `sendAndWait()`. */
  prompt: string;
  /** System prompt extracted from messages, if any. */
  systemPrompt: string | undefined;
  /** Warnings generated during conversion. */
  warnings: string[];
}

/**
 * Convert Vercel AI SDK messages to a Copilot SDK prompt string.
 *
 * Strategy:
 * - Extract system messages → systemPrompt (for session config)
 * - Build a formatted prompt from user/assistant/tool messages
 * - For single-turn: just the user message text
 * - For multi-turn: formatted conversation for context
 */
export function convertMessages(messages: ModelMessage[]): ConvertedMessages {
  const warnings: string[] = [];
  let systemPrompt: string | undefined;

  // Extract system messages
  const systemMessages = messages.filter(m => m.role === 'system');
  if (systemMessages.length > 0) {
    systemPrompt = systemMessages
      .map(m => extractText(m.content))
      .join('\n\n');
  }

  // Get non-system messages
  const conversationMessages = messages.filter(m => m.role !== 'system');

  if (conversationMessages.length === 0) {
    return { prompt: '', systemPrompt, warnings };
  }

  // If there's only one user message, return it directly
  if (conversationMessages.length === 1 && conversationMessages[0].role === 'user') {
    const text = extractText(conversationMessages[0].content);
    return { prompt: text, systemPrompt, warnings };
  }

  // Multi-turn: format as conversation context
  // The SDK session maintains its own history, but the AI SDK may send
  // the full history on each call. We format it so the SDK can understand
  // the context, but primarily use the last user message as the prompt.
  const parts: string[] = [];
  for (const msg of conversationMessages) {
    const text = extractText(msg.content);
    if (!text) continue;

    switch (msg.role) {
      case 'user':
        parts.push(`User: ${text}`);
        break;
      case 'assistant':
        parts.push(`Assistant: ${text}`);
        break;
      case 'tool':
        parts.push(`[Tool result]: ${text}`);
        break;
      default:
        warnings.push(`Unsupported message role: ${msg.role}`);
    }
  }

  // For multi-turn, send the full formatted conversation.
  // The SDK will handle deduplication with its internal history.
  return { prompt: parts.join('\n\n'), systemPrompt, warnings };
}

/** Extract plain text from a message content (string or ContentPart[]). */
function extractText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;

  return content
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}
