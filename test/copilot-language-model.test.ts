/**
 * Tests for CopilotLanguageModel — the core of the provider.
 *
 * Mocks the @github/copilot-sdk to test doGenerate() and doStream()
 * without requiring a real Copilot session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

// ── Mock SDK ────────────────────────────────────────────────────────────

type EventHandler = (evt: { data: any }) => void;

function createMockSession() {
  const handlers = new Map<string, EventHandler[]>();
  return {
    sessionId: 'mock-session-123',
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    sendAndWait: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    // Helper to emit events in tests
    _emit(event: string, data: any) {
      for (const h of handlers.get(event) ?? []) {
        h({ data });
      }
    },
  };
}

function createMockClient(session: ReturnType<typeof createMockSession>) {
  return {
    createSession: vi.fn().mockResolvedValue(session),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(),
  approveAll: vi.fn(),
}));

import { CopilotClient } from '@github/copilot-sdk';
import { CopilotLanguageModel } from '../src/copilot-language-model.js';

// ── Test helpers ────────────────────────────────────────────────────────

function createModel(settings = {}) {
  return new CopilotLanguageModel({
    id: 'default',
    settings: { token: 'test-token', ...settings },
  });
}

function minimalPrompt() {
  return {
    prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }],
  };
}

async function collectStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3StreamPart[]> {
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('CopilotLanguageModel', () => {
  let mockSession: ReturnType<typeof createMockSession>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockSession = createMockSession();
    mockClient = createMockClient(mockSession);
    vi.mocked(CopilotClient).mockImplementation(() => mockClient as any);
  });

  describe('properties', () => {
    it('has correct specification version', () => {
      const model = createModel();
      expect(model.specificationVersion).toBe('v3');
    });

    it('has correct provider name', () => {
      const model = createModel();
      expect(model.provider).toBe('copilot');
    });

    it('uses the provided model ID', () => {
      const model = new CopilotLanguageModel({
        id: 'gpt-4o',
        settings: { token: 'test' },
      });
      expect(model.modelId).toBe('gpt-4o');
    });
  });

  describe('doGenerate', () => {
    it('returns text content from the SDK', async () => {
      // Setup: sendAndWait resolves with message content
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.message_delta', { deltaContent: 'Hello ' });
        mockSession._emit('assistant.message_delta', { deltaContent: 'World' });
        return { data: { content: 'Hello World' } };
      });

      const model = createModel();
      const result = await model.doGenerate(minimalPrompt() as any);

      expect(result.content).toEqual([{ type: 'text', text: 'Hello World' }]);
      expect(result.finishReason).toEqual({ unified: 'stop', raw: 'completed' });
    });

    it('returns usage when available', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.usage', {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheWriteTokens: 3,
        });
        return { data: { content: 'result' } };
      });

      const model = createModel();
      const result = await model.doGenerate(minimalPrompt() as any);

      expect(result.usage.inputTokens.total).toBe(10);
      expect(result.usage.inputTokens.cacheRead).toBe(5);
      expect(result.usage.inputTokens.cacheWrite).toBe(3);
      expect(result.usage.outputTokens.total).toBe(20);
    });

    it('throws on auth error (missing token)', async () => {
      const model = new CopilotLanguageModel({
        id: 'default',
        settings: {},
      });
      // Clear env var
      const original = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      await expect(model.doGenerate(minimalPrompt() as any)).rejects.toThrow(
        'GITHUB_TOKEN',
      );

      process.env.GITHUB_TOKEN = original;
    });

    it('throws on SDK error instead of swallowing', async () => {
      mockSession.sendAndWait.mockRejectedValue(new Error('SDK exploded'));

      const model = createModel();
      await expect(model.doGenerate(minimalPrompt() as any)).rejects.toThrow(
        'SDK exploded',
      );
    });

    it('throws on timeout', async () => {
      mockSession.sendAndWait.mockRejectedValue(
        new Error('request timed out after 300000ms'),
      );

      const model = createModel();
      await expect(model.doGenerate(minimalPrompt() as any)).rejects.toThrow(
        'timed out',
      );
    });

    it('cleans up session and client on success', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'ok' },
      });

      const model = createModel();
      await model.doGenerate(minimalPrompt() as any);

      expect(mockSession.disconnect).toHaveBeenCalled();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it('cleans up session and client on error', async () => {
      mockSession.sendAndWait.mockRejectedValue(new Error('boom'));

      const model = createModel();
      await model.doGenerate(minimalPrompt() as any).catch(() => {});

      expect(mockSession.disconnect).toHaveBeenCalled();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it('generates warnings for caller-defined tools', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'hi' },
      });

      const model = createModel();
      const opts = {
        ...minimalPrompt(),
        tools: [{ type: 'function', name: 'test', parameters: {} }],
      };
      const result = await model.doGenerate(opts as any);

      expect(result.warnings.some((w: any) => w.feature === 'tools')).toBe(true);
    });

    it('returns response metadata with id and timestamp', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'hi' },
      });

      const model = createModel();
      const result = await model.doGenerate(minimalPrompt() as any);

      expect(result.response?.id).toBeDefined();
      expect(result.response?.timestamp).toBeInstanceOf(Date);
      expect(result.response?.modelId).toBe('default');
    });
  });

  describe('doStream', () => {
    it('emits stream-start as first part', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'hi' },
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      expect(parts[0].type).toBe('stream-start');
    });

    it('emits text-start, text-delta, text-end for text content', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.message_delta', { deltaContent: 'Hello ' });
        mockSession._emit('assistant.message_delta', { deltaContent: 'World' });
        return { data: { content: 'Hello World' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const textParts = parts.filter(
        (p) => p.type === 'text-start' || p.type === 'text-delta' || p.type === 'text-end',
      );
      expect(textParts.length).toBe(4); // start + 2 deltas + end
      expect(textParts[0].type).toBe('text-start');
      expect(textParts[1].type).toBe('text-delta');
      expect((textParts[1] as any).delta).toBe('Hello ');
      expect(textParts[2].type).toBe('text-delta');
      expect((textParts[2] as any).delta).toBe('World');
      expect(textParts[3].type).toBe('text-end');
    });

    it('emits reasoning blocks for reasoning deltas', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.reasoning_delta', { deltaContent: 'thinking...' });
        mockSession._emit('assistant.reasoning_delta', { deltaContent: 'more thinking' });
        return { data: { content: 'answer' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const reasoningParts = parts.filter(
        (p) =>
          p.type === 'reasoning-start' ||
          p.type === 'reasoning-delta' ||
          p.type === 'reasoning-end',
      );
      expect(reasoningParts.length).toBe(4); // start + 2 deltas + end
      expect(reasoningParts[0].type).toBe('reasoning-start');
      expect((reasoningParts[1] as any).delta).toBe('thinking...');
      expect(reasoningParts[3].type).toBe('reasoning-end');
    });

    it('emits tool-call and tool-result for provider-executed tools', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('tool.execution_start', {
          toolCallId: 'sdk-tc-1',
          toolName: 'read_file',
          arguments: { path: '/src/main.ts' },
        });
        mockSession._emit('tool.execution_complete', {
          toolCallId: 'sdk-tc-1',
          success: true,
          result: { content: 'file contents' },
        });
        return { data: { content: 'I read the file' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const toolCall = parts.find((p) => p.type === 'tool-call') as any;
      expect(toolCall).toBeDefined();
      expect(toolCall.toolName).toBe('read_file');
      expect(toolCall.toolCallId).toBe('tc-0');
      expect(JSON.parse(toolCall.input)).toEqual({ path: '/src/main.ts' });
      expect(toolCall.providerExecuted).toBe(true);

      const toolResult = parts.find((p) => p.type === 'tool-result') as any;
      expect(toolResult).toBeDefined();
      expect(toolResult.toolCallId).toBe('tc-0');
      expect(toolResult.result).toBe('file contents');
      expect(toolResult.isError).toBe(false);
    });

    it('marks failed tool results with isError', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('tool.execution_start', {
          toolCallId: 'sdk-tc-1',
          toolName: 'bash',
          arguments: { command: 'fail' },
        });
        mockSession._emit('tool.execution_complete', {
          toolCallId: 'sdk-tc-1',
          success: false,
          result: { content: 'command failed' },
        });
        return { data: { content: 'failed' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const toolResult = parts.find((p) => p.type === 'tool-result') as any;
      expect(toolResult.isError).toBe(true);
    });

    it('emits finish with stop reason on success', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'done' },
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const finish = parts.find((p) => p.type === 'finish') as any;
      expect(finish).toBeDefined();
      expect(finish.finishReason).toEqual({ unified: 'stop', raw: 'completed' });
    });

    it('emits error part and finish with error reason on SDK failure', async () => {
      mockSession.sendAndWait.mockRejectedValue(new Error('SDK crashed'));

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const errorPart = parts.find((p) => p.type === 'error') as any;
      expect(errorPart).toBeDefined();
      expect(errorPart.error.message).toBe('SDK crashed');

      const finish = parts.find((p) => p.type === 'finish') as any;
      expect(finish.finishReason.unified).toBe('error');
    });

    it('emits finish with other/timeout reason on timeout', async () => {
      mockSession.sendAndWait.mockRejectedValue(
        new Error('request timed out after 300000ms'),
      );

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const finish = parts.find((p) => p.type === 'finish') as any;
      expect(finish.finishReason).toEqual({ unified: 'other', raw: 'timeout' });
    });

    it('closes text blocks on error (paired start/end)', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.message_delta', { deltaContent: 'partial' });
        throw new Error('mid-stream crash');
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const starts = parts.filter((p) => p.type === 'text-start');
      const ends = parts.filter((p) => p.type === 'text-end');
      expect(starts.length).toBe(1);
      expect(ends.length).toBe(1);
      expect((starts[0] as any).id).toBe((ends[0] as any).id);
    });

    it('closes reasoning blocks on error (paired start/end)', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.reasoning_delta', { deltaContent: 'thinking' });
        throw new Error('mid-stream crash');
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const starts = parts.filter((p) => p.type === 'reasoning-start');
      const ends = parts.filter((p) => p.type === 'reasoning-end');
      expect(starts.length).toBe(1);
      expect(ends.length).toBe(1);
    });

    it('emits fallback text when no deltas but final content exists', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'Final answer without deltas' },
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const textDeltas = parts.filter((p) => p.type === 'text-delta');
      expect(textDeltas.length).toBe(1);
      expect((textDeltas[0] as any).delta).toBe('Final answer without deltas');
    });

    it('cleans up session and client after stream', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'done' },
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      await collectStream(stream);

      expect(mockSession.disconnect).toHaveBeenCalled();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it('includes warnings for unsupported toolChoice', async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: 'ok' },
      });

      const model = createModel();
      const opts = {
        ...minimalPrompt(),
        toolChoice: { type: 'auto' },
      };
      const { stream } = await model.doStream(opts as any);
      const parts = await collectStream(stream);

      const streamStart = parts.find((p) => p.type === 'stream-start') as any;
      expect(
        streamStart.warnings.some((w: any) => w.feature === 'toolChoice'),
      ).toBe(true);
    });

    it('captures usage from SDK events', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('assistant.usage', {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: undefined,
        });
        return { data: { content: 'done' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const finish = parts.find((p) => p.type === 'finish') as any;
      expect(finish.usage.inputTokens.total).toBe(100);
      expect(finish.usage.outputTokens.total).toBe(50);
      expect(finish.usage.inputTokens.cacheRead).toBe(10);
    });

    it('emits error part for session.error events', async () => {
      mockSession.sendAndWait.mockImplementation(async () => {
        mockSession._emit('session.error', { message: 'session exploded' });
        return { data: { content: 'partial' } };
      });

      const model = createModel();
      const { stream } = await model.doStream(minimalPrompt() as any);
      const parts = await collectStream(stream);

      const errorPart = parts.find((p) => p.type === 'error') as any;
      expect(errorPart).toBeDefined();
      expect(errorPart.error.message).toBe('session exploded');
    });
  });
});
