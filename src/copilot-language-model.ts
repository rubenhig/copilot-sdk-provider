/**
 * CopilotLanguageModel — LanguageModelV3 implementation wrapping
 * the GitHub Copilot SDK (`@github/copilot-sdk`).
 *
 * This is the core of the provider. It translates between the Vercel AI SDK's
 * stateless request/response model and the Copilot SDK's stateful session model.
 *
 * Pattern based on `ai-sdk-provider-claude-code`.
 */
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type {
  CopilotSession,
  SessionConfig,
} from '@github/copilot-sdk';

import type { CopilotSettings, CopilotModelId, CopilotLogger } from './types.js';
import { convertMessages } from './convert-messages.js';
import { mapFinishReason } from './map-finish-reason.js';
import { createAuthError, createSDKError, isAuthError } from './errors.js';
import { getLogger } from './logger.js';

// V3 types we need to construct
type DoGenerateOptions = Parameters<LanguageModelV3['doGenerate']>[0];
type DoGenerateResult  = Awaited<ReturnType<LanguageModelV3['doGenerate']>>;
type DoStreamOptions   = Parameters<LanguageModelV3['doStream']>[0];
type DoStreamResult    = Awaited<ReturnType<LanguageModelV3['doStream']>>;

function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

const MAX_TOOL_RESULT_LENGTH = 10_000;

function truncateResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_LENGTH) return text;
  return text.slice(0, MAX_TOOL_RESULT_LENGTH) + '\n…(truncated)';
}

export class CopilotLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'copilot';
  readonly modelId: CopilotModelId;
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportsStructuredOutputs = false;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly settings: CopilotSettings;
  private readonly logger: CopilotLogger;

  constructor(options: { id: CopilotModelId; settings: CopilotSettings }) {
    this.modelId = options.id;
    this.settings = options.settings;
    this.logger = getLogger(options.settings.verbose, options.settings.logger);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private getToken(): string {
    const token = this.settings.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw createAuthError(
        'GITHUB_TOKEN is required. Set it as an environment variable or pass it via settings.token.'
      );
    }
    return token;
  }

  private buildSessionConfig(): SessionConfig {
    const systemPromptSetting = this.settings.systemPrompt;
    const config: SessionConfig = {
      onPermissionRequest: this.settings.onPermissionRequest ?? approveAll,
      ...(this.settings.onUserInputRequest && {
        onUserInputRequest: this.settings.onUserInputRequest,
      }),
      ...(this.settings.onElicitationRequest && {
        onElicitationRequest: this.settings.onElicitationRequest,
      }),
      ...(this.settings.hooks && { hooks: this.settings.hooks }),
      ...(this.settings.tools && { tools: this.settings.tools }),
      ...(this.settings.availableTools && { availableTools: this.settings.availableTools }),
      ...(this.settings.excludedTools && { excludedTools: this.settings.excludedTools }),
      ...(this.settings.cwd && { workingDirectory: this.settings.cwd }),
      ...(this.modelId !== 'default' && { model: this.modelId }),
      ...(this.settings.model && { model: this.settings.model }),
      ...(systemPromptSetting && {
        systemMessage: { mode: 'replace' as const, content: systemPromptSetting },
      }),
      ...this.settings.sessionConfig,
    };
    return config;
  }

  private async createClientAndSession(): Promise<{
    client: CopilotClient;
    session: CopilotSession;
  }> {
    const token = this.getToken();
    this.logger.debug(`Creating CopilotClient (cwd: ${this.settings.cwd ?? 'inherit'})`);

    const clientOptions = {
      ...this.settings.clientOptions,
      ...(this.settings.cwd && { cwd: this.settings.cwd }),
      env: {
        ...process.env,
        GITHUB_TOKEN: token,
        ...this.settings.clientOptions?.env,
      },
    };

    const client = new CopilotClient(clientOptions);
    const sessionConfig = this.buildSessionConfig();

    this.logger.debug(`Creating session (model: ${this.modelId})`);
    const session = await client.createSession(sessionConfig);
    this.logger.info(`Session created: ${session.sessionId}`);

    return { client, session };
  }

  private generateWarnings(options: DoGenerateOptions | DoStreamOptions): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];

    // The Copilot SDK manages its own tools — caller-defined tools are not supported
    if (options.tools && options.tools.length > 0) {
      warnings.push({
        type: 'unsupported' as const,
        feature: 'tools',
        details: 'Copilot provider uses SDK-managed tools. Caller-defined tools are ignored.',
      });
    }

    if (options.toolChoice) {
      warnings.push({
        type: 'unsupported' as const,
        feature: 'toolChoice',
        details: 'Copilot provider does not support toolChoice. The SDK decides tool usage.',
      });
    }

    return warnings;
  }

  // ── doGenerate (non-streaming) ──────────────────────────────────────────

  async doGenerate(options: DoGenerateOptions): Promise<DoGenerateResult> {
    this.logger.debug('doGenerate: starting');

    const { prompt: promptStr, warnings: convWarnings } =
      convertMessages(options.prompt as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const warnings = this.generateWarnings(options);
    convWarnings.forEach(w => warnings.push({ type: 'other', message: w }));

    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    let text = '';
    let usage: LanguageModelV3Usage = createEmptyUsage();
    let finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: undefined };
    let timedOut = false;
    let errored = false;

    try {
      ({ client, session } = await this.createClientAndSession());

      // Collect text from events
      const unsub = session.on('assistant.message_delta', (evt) => {
        text += evt.data.deltaContent;
      });

      // Collect usage
      const unsubUsage = session.on('assistant.usage', (evt) => {
        usage = {
          inputTokens: {
            total: evt.data.inputTokens ?? undefined,
            noCache: undefined,
            cacheRead: evt.data.cacheReadTokens ?? undefined,
            cacheWrite: evt.data.cacheWriteTokens ?? undefined,
          },
          outputTokens: {
            total: evt.data.outputTokens ?? undefined,
            text: undefined,
            reasoning: undefined,
          },
        };
      });

      const timeout = this.settings.maxTurnTimeout ?? 300_000;
      this.logger.debug(`doGenerate: sendAndWait (timeout: ${timeout}ms)`);

      const result = await session.sendAndWait({ prompt: promptStr }, timeout);

      unsub();
      unsubUsage();

      // Use the final message content if available (may be more complete)
      if (result?.data.content) {
        text = result.data.content;
      }

      this.logger.info(`doGenerate: completed (${text.length} chars)`);
    } catch (error) {
      if (isAuthError(error)) throw error;
      if (error instanceof Error && error.message.includes('timed out')) {
        timedOut = true;
      } else {
        errored = true;
      }
      this.logger.error(`doGenerate: error — ${error}`);
    } finally {
      if (session) await session.disconnect().catch(() => {});
      if (client) await client.stop().catch(() => {});
    }

    finishReason = mapFinishReason(!errored && !timedOut, timedOut, errored);

    return {
      content: [{ type: 'text' as const, text }],
      usage,
      finishReason,
      warnings,
      response: {
        id: generateId(),
        timestamp: new Date(),
        modelId: this.modelId,
      },
      request: { body: promptStr },
      providerMetadata: {
        copilot: {
          ...(session && { sessionId: session.sessionId }),
        },
      },
    };
  }

  // ── doStream (streaming) ────────────────────────────────────────────────

  async doStream(options: DoStreamOptions): Promise<DoStreamResult> {
    this.logger.debug('doStream: starting');

    const { prompt: promptStr, warnings: convWarnings } =
      convertMessages(options.prompt as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const warnings = this.generateWarnings(options);
    convWarnings.forEach(w => warnings.push({ type: 'other', message: w }));

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        let client: CopilotClient | undefined;
        let session: CopilotSession | undefined;
        let textPartId: string | undefined;
        let toolIdx = 0;
        const toolMap = new Map<string, { callId: string; toolName: string }>();
        let usage: LanguageModelV3Usage = createEmptyUsage();
        let timedOut = false;
        let errored = false;

        try {
          // Emit stream-start
          controller.enqueue({ type: 'stream-start', warnings });

          ({ client, session } = await this.createClientAndSession());

          // ── Wire SDK events → V3 stream parts ──

          // Text streaming
          const unsubDelta = session.on('assistant.message_delta', (evt) => {
            if (!textPartId) {
              textPartId = generateId();
              controller.enqueue({ type: 'text-start', id: textPartId });
            }
            controller.enqueue({
              type: 'text-delta',
              id: textPartId,
              delta: evt.data.deltaContent,
            });
          });

          // Reasoning / extended thinking
          let reasoningPartId: string | undefined;
          const unsubReasoning = session.on('assistant.reasoning_delta', (evt) => {
            if (!reasoningPartId) {
              reasoningPartId = generateId();
              controller.enqueue({ type: 'reasoning-start', id: reasoningPartId });
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: reasoningPartId,
              delta: (evt.data as any).deltaContent ?? '', // eslint-disable-line @typescript-eslint/no-explicit-any
            });
          });

          // Tool execution start → tool-call
          const unsubToolStart = session.on('tool.execution_start', (evt) => {
            const sdkId = evt.data.toolCallId;
            const callId = `tc-${toolIdx++}`;
            const toolName = evt.data.toolName;
            toolMap.set(sdkId, { callId, toolName });

            const argsStr = evt.data.arguments
              ? JSON.stringify(evt.data.arguments)
              : '{}';

            controller.enqueue({
              type: 'tool-call',
              toolCallId: callId,
              toolName,
              input: argsStr,
              providerExecuted: true,
              dynamic: true,
            } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
          });

          // Tool execution complete → tool-result
          const unsubToolEnd = session.on('tool.execution_complete', (evt) => {
            const sdkId = evt.data.toolCallId;
            const entry = toolMap.get(sdkId);
            if (!entry) return;

            const resultContent = evt.data.result?.content ?? '';
            const resultStr = truncateResult(
              typeof resultContent === 'string'
                ? resultContent
                : JSON.stringify(resultContent)
            );

            controller.enqueue({
              type: 'tool-result',
              toolCallId: entry.callId,
              toolName: entry.toolName,
              output: resultStr,
              providerExecuted: true,
            } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

            toolMap.delete(sdkId);
          });

          // Usage
          const unsubUsage = session.on('assistant.usage', (evt) => {
            usage = {
              inputTokens: {
                total: evt.data.inputTokens ?? undefined,
                noCache: undefined,
                cacheRead: evt.data.cacheReadTokens ?? undefined,
                cacheWrite: evt.data.cacheWriteTokens ?? undefined,
              },
              outputTokens: {
                total: evt.data.outputTokens ?? undefined,
                text: undefined,
                reasoning: undefined,
              },
            };
          });

          // Errors
          const unsubError = session.on('session.error', (evt) => {
            this.logger.error(`SDK session error: ${evt.data.message}`);
            controller.enqueue({
              type: 'error',
              error: createSDKError(evt.data.message),
            });
          });

          // ── Send and wait ──
          const timeout = this.settings.maxTurnTimeout ?? 300_000;
          this.logger.debug(`doStream: sendAndWait (timeout: ${timeout}ms)`);

          const result = await session.sendAndWait({ prompt: promptStr }, timeout);

          // If we got a final message but no deltas were emitted,
          // emit the full text as a single block
          if (!textPartId && result?.data.content) {
            textPartId = generateId();
            controller.enqueue({ type: 'text-start', id: textPartId });
            controller.enqueue({
              type: 'text-delta',
              id: textPartId,
              delta: result.data.content,
            });
          }

          // Unsubscribe all
          unsubDelta();
          unsubReasoning();
          unsubToolStart();
          unsubToolEnd();
          unsubUsage();
          unsubError();

          // Close any open parts
          if (textPartId) {
            controller.enqueue({ type: 'text-end', id: textPartId });
          }
          if (reasoningPartId) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningPartId });
          }

          this.logger.info(`doStream: completed (session: ${session.sessionId})`);

        } catch (error) {
          if (error instanceof Error && error.message.includes('timed out')) {
            timedOut = true;
          } else {
            errored = true;
          }
          this.logger.error(`doStream: error — ${error}`);

          if (isAuthError(error)) {
            controller.enqueue({ type: 'error', error: error as Error });
          }
        } finally {
          // Emit finish
          const finishReason = mapFinishReason(!errored && !timedOut, timedOut, errored);
          controller.enqueue({
            type: 'finish',
            finishReason,
            usage,
            providerMetadata: {
              copilot: {
                ...(session && { sessionId: session.sessionId }),
              },
            },
          });

          // Clean up
          if (session) await session.disconnect().catch(() => {});
          if (client) await client.stop().catch(() => {});
          controller.close();
        }
      },
    });

    return {
      stream: stream as ReadableStream<LanguageModelV3StreamPart>,
    };
  }
}
