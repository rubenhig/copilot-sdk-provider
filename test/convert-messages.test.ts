import { describe, it, expect } from 'vitest';
import { convertMessages } from '../src/convert-messages.js';

describe('convertMessages', () => {
  describe('single user message', () => {
    it('extracts a simple string content message', () => {
      const result = convertMessages([
        { role: 'user', content: 'Hello, world!' },
      ]);
      expect(result.prompt).toBe('Hello, world!');
      expect(result.systemPrompt).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it('extracts text from content parts array', () => {
      const result = convertMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First part' },
            { type: 'text', text: 'Second part' },
          ],
        },
      ]);
      expect(result.prompt).toBe('First part\nSecond part');
    });

    it('ignores non-text content parts', () => {
      const result = convertMessages([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image', url: 'http://example.com/img.png' },
          ],
        },
      ]);
      expect(result.prompt).toBe('Hello');
    });
  });

  describe('system messages', () => {
    it('extracts system prompt from a system message', () => {
      const result = convertMessages([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi!' },
      ]);
      expect(result.systemPrompt).toBe('You are a helpful assistant.');
      expect(result.prompt).toBe('Hi!');
    });

    it('concatenates multiple system messages', () => {
      const result = convertMessages([
        { role: 'system', content: 'Rule 1' },
        { role: 'system', content: 'Rule 2' },
        { role: 'user', content: 'Go' },
      ]);
      expect(result.systemPrompt).toBe('Rule 1\n\nRule 2');
    });
  });

  describe('multi-turn conversations', () => {
    it('formats user + assistant + user as labeled transcript', () => {
      const result = convertMessages([
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'And 3+3?' },
      ]);
      expect(result.prompt).toContain('User: What is 2+2?');
      expect(result.prompt).toContain('Assistant: 4');
      expect(result.prompt).toContain('User: And 3+3?');
    });

    it('includes tool results in transcript', () => {
      const result = convertMessages([
        { role: 'user', content: 'Read file X' },
        { role: 'tool', content: 'file contents here' },
        { role: 'assistant', content: 'I found...' },
      ]);
      expect(result.prompt).toContain('[Tool result]: file contents here');
    });
  });

  describe('edge cases', () => {
    it('returns empty prompt for empty messages array', () => {
      const result = convertMessages([]);
      expect(result.prompt).toBe('');
      expect(result.systemPrompt).toBeUndefined();
    });

    it('handles messages with empty content', () => {
      const result = convertMessages([
        { role: 'user', content: '' },
      ]);
      expect(result.prompt).toBe('');
    });

    it('handles content parts with empty text', () => {
      const result = convertMessages([
        {
          role: 'user',
          content: [{ type: 'text', text: '' }],
        },
      ]);
      expect(result.prompt).toBe('');
    });

    it('generates warning for unknown message role', () => {
      const result = convertMessages([
        { role: 'user', content: 'hi' },
        { role: 'function' as any, content: 'fn result' },
      ]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Unsupported message role');
    });
  });
});
