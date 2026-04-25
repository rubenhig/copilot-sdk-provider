/**
 * Provider factory for the Copilot AI SDK provider.
 *
 * Creates a `ProviderV3`-compatible provider following the same pattern as
 * `ai-sdk-provider-claude-code` and other community providers.
 *
 * Usage:
 * ```typescript
 * import { createCopilot, copilot } from 'copilot-ai-provider';
 *
 * // With defaults (reads GITHUB_TOKEN from env)
 * const result = await streamText({ model: copilot('default'), prompt: '...' });
 *
 * // With custom settings
 * const myProvider = createCopilot({ cwd: '/my/repo', systemPrompt: '...' });
 * const result = await streamText({ model: myProvider('default'), prompt: '...' });
 * ```
 */
import { NoSuchModelError } from '@ai-sdk/provider';

import type { CopilotSettings, CopilotModelId } from './types.js';
import { CopilotLanguageModel } from './copilot-language-model.js';

/** Options passed to `createCopilot()`. */
export interface CopilotProviderOptions extends CopilotSettings {
  /**
   * Default settings applied to all model instances created by this provider.
   * These can be overridden per-model call.
   */
  defaultSettings?: CopilotSettings;
}

/**
 * The Copilot provider type — callable as a function and has named methods.
 */
export interface CopilotProvider {
  (modelId: CopilotModelId, settings?: CopilotSettings): CopilotLanguageModel;

  /** The specification version. */
  readonly specificationVersion: 'v3';

  /** Create a language model (alias). */
  languageModel(modelId: CopilotModelId, settings?: CopilotSettings): CopilotLanguageModel;

  /** Create a chat model (same as languageModel for Copilot). */
  chat(modelId: CopilotModelId, settings?: CopilotSettings): CopilotLanguageModel;

  /** Not supported — throws NoSuchModelError. */
  embeddingModel(modelId: string): never;

  /** Not supported — throws NoSuchModelError. */
  imageModel(modelId: string): never;
}

/**
 * Create a Copilot AI SDK provider.
 *
 * @param options - Provider-level settings (applied to all models unless overridden)
 * @returns A callable provider that creates `CopilotLanguageModel` instances
 */
export function createCopilot(options: CopilotProviderOptions = {}): CopilotProvider {
  const { defaultSettings, ...providerSettings } = options;

  const createModel = (
    modelId: CopilotModelId,
    settings: CopilotSettings = {},
  ): CopilotLanguageModel => {
    // Merge: provider defaults → provider settings → per-model settings
    const mergedSettings: CopilotSettings = {
      ...defaultSettings,
      ...providerSettings,
      ...settings,
    };

    return new CopilotLanguageModel({
      id: modelId,
      settings: mergedSettings,
    });
  };

  // The provider is callable as a function
  const callable = function (
    modelId: CopilotModelId,
    settings?: CopilotSettings,
  ): CopilotLanguageModel {
    return createModel(modelId, settings);
  };

  // Build the full provider object
  const provider: CopilotProvider = Object.assign(callable, {
    specificationVersion: 'v3' as const,
    languageModel: createModel,
    chat: createModel,
    embeddingModel: (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'embeddingModel',
      });
    },
    imageModel: (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'imageModel',
      });
    },
  });

  return provider;
}

/** Default Copilot provider instance. */
export const copilot = createCopilot();
