import { describe, it, expect, vi } from 'vitest';
import { getLogger, silentLogger, consoleLogger } from '../src/logger.js';

describe('silentLogger', () => {
  it('has all log methods', () => {
    expect(typeof silentLogger.debug).toBe('function');
    expect(typeof silentLogger.info).toBe('function');
    expect(typeof silentLogger.warn).toBe('function');
    expect(typeof silentLogger.error).toBe('function');
  });

  it('does not output anything', () => {
    const spy = vi.spyOn(console, 'debug');
    silentLogger.debug('test');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('consoleLogger', () => {
  it('calls console methods with prefix', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleLogger.info('hello');
    expect(spy).toHaveBeenCalledWith('[copilot-provider]', 'hello');
    spy.mockRestore();
  });
});

describe('getLogger', () => {
  it('returns silent logger when verbose is false', () => {
    expect(getLogger(false)).toBe(silentLogger);
  });

  it('returns silent logger when verbose is undefined', () => {
    expect(getLogger()).toBe(silentLogger);
  });

  it('returns console logger when verbose is true', () => {
    expect(getLogger(true)).toBe(consoleLogger);
  });

  it('returns custom logger when provided', () => {
    const custom = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    expect(getLogger(true, custom)).toBe(custom);
    expect(getLogger(false, custom)).toBe(custom);
  });
});
