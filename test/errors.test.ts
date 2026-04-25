import { describe, it, expect } from 'vitest';
import {
  createAuthError,
  createTimeoutError,
  createSDKError,
  isAuthError,
  isTimeoutError,
  isRetryableError,
} from '../src/errors.js';

describe('createAuthError', () => {
  it('creates an error with CopilotAuthError name', () => {
    const err = createAuthError('missing token');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CopilotAuthError');
    expect(err.message).toBe('missing token');
  });
});

describe('createTimeoutError', () => {
  it('creates an error with CopilotTimeoutError name', () => {
    const err = createTimeoutError('Session timed out after 5000ms');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CopilotTimeoutError');
    expect(err.message).toContain('timed out');
  });
});

describe('createSDKError', () => {
  it('creates an error with CopilotSDKError name', () => {
    const err = createSDKError('something failed');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CopilotSDKError');
    expect(err.message).toBe('something failed');
  });

  it('preserves cause when provided', () => {
    const cause = new Error('root cause');
    const err = createSDKError('wrapper', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('isAuthError', () => {
  it('detects CopilotAuthError by name', () => {
    expect(isAuthError(createAuthError('test'))).toBe(true);
  });

  it('detects auth-related error messages', () => {
    expect(isAuthError(new Error('GITHUB_TOKEN not set'))).toBe(true);
    expect(isAuthError(new Error('unauthorized'))).toBe(true);
    expect(isAuthError(new Error('authentication failed'))).toBe(true);
    expect(isAuthError(new Error('HTTP 401'))).toBe(true);
  });

  it('returns false for non-auth errors', () => {
    expect(isAuthError(new Error('some other error'))).toBe(false);
    expect(isAuthError('string error')).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe('isTimeoutError', () => {
  it('detects CopilotTimeoutError by name', () => {
    expect(isTimeoutError(createTimeoutError('timed out'))).toBe(true);
  });

  it('detects timeout-related messages', () => {
    expect(isTimeoutError(new Error('request timed out'))).toBe(true);
    expect(isTimeoutError(new Error('timeout reached'))).toBe(true);
  });

  it('returns false for non-timeout errors', () => {
    expect(isTimeoutError(new Error('connection refused'))).toBe(false);
    expect(isTimeoutError(42)).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('considers timeout errors retryable', () => {
    expect(isRetryableError(createTimeoutError('timed out'))).toBe(true);
  });

  it('considers network errors retryable', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('does not consider auth errors retryable', () => {
    expect(isRetryableError(createAuthError('bad token'))).toBe(false);
  });

  it('does not consider general errors retryable', () => {
    expect(isRetryableError(new Error('parse error'))).toBe(false);
  });
});
