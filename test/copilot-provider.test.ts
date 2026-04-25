import { describe, it, expect, vi } from 'vitest';
import { NoSuchModelError } from '@ai-sdk/provider';

// Mock the SDK to avoid module resolution errors in test env
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(),
  approveAll: vi.fn(),
}));

import { createCopilot, copilot, CopilotLanguageModel } from '../src/index.js';

describe('createCopilot', () => {
  it('returns a callable provider', () => {
    const provider = createCopilot();
    expect(typeof provider).toBe('function');
    expect(provider.specificationVersion).toBe('v3');
  });

  it('creates a CopilotLanguageModel when called', () => {
    const provider = createCopilot({ token: 'test-token' });
    const model = provider('default');
    expect(model).toBeInstanceOf(CopilotLanguageModel);
    expect(model.modelId).toBe('default');
    expect(model.provider).toBe('copilot');
    expect(model.specificationVersion).toBe('v3');
  });

  it('creates model with custom modelId', () => {
    const provider = createCopilot({ token: 'test-token' });
    const model = provider('gpt-4o');
    expect(model.modelId).toBe('gpt-4o');
  });

  it('has languageModel() alias', () => {
    const provider = createCopilot({ token: 'test-token' });
    const model = provider.languageModel('default');
    expect(model).toBeInstanceOf(CopilotLanguageModel);
  });

  it('has chat() alias', () => {
    const provider = createCopilot({ token: 'test-token' });
    const model = provider.chat('default');
    expect(model).toBeInstanceOf(CopilotLanguageModel);
  });

  it('throws NoSuchModelError for embeddingModel', () => {
    const provider = createCopilot();
    expect(() => provider.embeddingModel('any')).toThrow(NoSuchModelError);
  });

  it('throws NoSuchModelError for imageModel', () => {
    const provider = createCopilot();
    expect(() => provider.imageModel('any')).toThrow(NoSuchModelError);
  });
});

describe('copilot (default instance)', () => {
  it('is a callable provider', () => {
    expect(typeof copilot).toBe('function');
    expect(copilot.specificationVersion).toBe('v3');
  });

  it('creates models', () => {
    const model = copilot('default');
    expect(model).toBeInstanceOf(CopilotLanguageModel);
  });
});

describe('settings merging', () => {
  it('merges provider-level and model-level settings', () => {
    const provider = createCopilot({
      token: 'provider-token',
      cwd: '/provider/dir',
    });
    // Model-level settings should override
    const model = provider('default', { cwd: '/model/dir' });
    expect(model).toBeInstanceOf(CopilotLanguageModel);
    // We can't inspect private settings directly, but the model was created
    // successfully with merged settings
  });

  it('supports defaultSettings option', () => {
    const provider = createCopilot({
      defaultSettings: { verbose: true },
      token: 'test-token',
    });
    const model = provider('default');
    expect(model).toBeInstanceOf(CopilotLanguageModel);
  });
});
