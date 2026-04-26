# copilot-sdk-provider

[Vercel AI SDK](https://ai-sdk.dev) community provider for [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk) — use Copilot as a `LanguageModelV3`.

[![npm version](https://img.shields.io/npm/v/copilot-sdk-provider.svg)](https://www.npmjs.com/package/copilot-sdk-provider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI SDK v3](https://img.shields.io/badge/AI%20SDK-v3-blue.svg)](https://ai-sdk.dev)

> **Status:** Public Preview — the underlying `@github/copilot-sdk` is in public preview.
>
> **Disclaimer:** This is an unofficial community provider. It is not endorsed by or affiliated with GitHub or Vercel.

## Overview

This provider wraps the **GitHub Copilot SDK** (`@github/copilot-sdk`) as a standard Vercel AI SDK `LanguageModelV3`, allowing you to use GitHub Copilot with `generateText()` and `streamText()` for text generation and streaming.

Unlike HTTP-based providers (OpenAI, Anthropic, etc.), this provider communicates with a **local Copilot CLI subprocess** that manages sessions, tool execution, and conversation state. This gives you access to Copilot's built-in agentic capabilities — file operations, code search, terminal commands — directly through the AI SDK interface.

> **Note:** AI SDK caller-defined `tools` and structured outputs are not supported — Copilot uses its own built-in tools. You can register additional SDK tools via settings. See [Limitations](#limitations) for details.

## Features

- 🔌 **AI SDK integration** — use `generateText()`, `streamText()` with Copilot
- 🛠️ **Built-in agentic tools** — Copilot's native tools (file I/O, search, terminal) work automatically
- 🔐 **GitHub token auth** — authenticate with `GITHUB_TOKEN` (from `gh auth token` or PAT)
- ⚙️ **Custom SDK tools** — register additional SDK tools via `defineTool()` in settings
- 💬 **System prompt** — override or extend Copilot's system instructions
- 🔄 **Multi-turn conversations** — conversation history converted to transcript format
- 📊 **Usage tracking** — input/output token counts when available
- 🧩 **Permission & input handlers** — hook into Copilot's permission and user-input flows
- 🏗️ **TypeScript-first** — full type safety with dual ESM + CJS builds

## Installation

```bash
npm install copilot-sdk-provider @github/copilot-sdk ai
```

### Prerequisites

- **Node.js** ≥ 18
- **GitHub Copilot subscription** (Individual, Business, or Enterprise)
- **GitHub token** — one of:
  - `gh auth token` (GitHub CLI — recommended)
  - Personal Access Token with `copilot` scope
  - `GITHUB_TOKEN` environment variable

## Quick Start

```typescript
import { generateText } from 'ai';
import { copilot } from 'copilot-sdk-provider';

const result = await generateText({
  model: copilot('default'),
  prompt: 'Explain the authentication flow in this codebase',
});

console.log(result.text);
```

## Usage

### Basic Text Generation

```typescript
import { generateText } from 'ai';
import { copilot } from 'copilot-sdk-provider';

const result = await generateText({
  model: copilot('default'),
  prompt: 'What does the main function do?',
});

console.log(result.text);
console.log(result.usage);       // { inputTokens, outputTokens }
console.log(result.finishReason); // 'stop'
```

### Streaming

```typescript
import { streamText } from 'ai';
import { copilot } from 'copilot-sdk-provider';

const result = streamText({
  model: copilot('default'),
  prompt: 'Refactor this function for readability',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

> **Note:** See [Streaming Behavior](#streaming-behavior) for details on how streaming works with the Copilot SDK.

### System Prompt

```typescript
import { generateText } from 'ai';
import { copilot } from 'copilot-sdk-provider';

// Via AI SDK's system parameter
const result = await generateText({
  model: copilot('default'),
  system: 'You are a code reviewer. Focus on security issues.',
  prompt: 'Review the authentication module',
});

// Or via provider settings
const result2 = await generateText({
  model: copilot('default', {
    systemPrompt: 'You are a code reviewer. Focus on security issues.',
  }),
  prompt: 'Review the authentication module',
});
```

### Custom Provider Instance

```typescript
import { generateText } from 'ai';
import { createCopilot } from 'copilot-sdk-provider';

const myProvider = createCopilot({
  token: process.env.MY_GITHUB_TOKEN,
  cwd: '/path/to/my/project',
  systemPrompt: 'You are an expert in this codebase.',
  maxTurnTimeout: 120_000, // 2 minutes
  verbose: true,
});

const result = await generateText({
  model: myProvider('default'),
  prompt: 'Find all TODO comments in the project',
});
```

### Multi-Turn Conversation

```typescript
import { generateText } from 'ai';
import { copilot } from 'copilot-sdk-provider';

const result = await generateText({
  model: copilot('default'),
  messages: [
    { role: 'user', content: 'What files are in the src/ directory?' },
    { role: 'assistant', content: 'The src/ directory contains: index.ts, utils.ts, config.ts' },
    { role: 'user', content: 'Show me the contents of config.ts' },
  ],
});
```

### Working Directory

```typescript
import { copilot } from 'copilot-sdk-provider';

// Set cwd so Copilot's tools operate on the right project
const model = copilot('default', { cwd: '/path/to/my/repo' });
```

### Custom Tools (SDK Tools)

```typescript
import { generateText } from 'ai';
import { createCopilot } from 'copilot-sdk-provider';
import { defineTool } from '@github/copilot-sdk';

const dbQueryTool = defineTool({
  name: 'query_database',
  description: 'Run a SQL query against the project database',
  parameters: { query: { type: 'string', description: 'SQL query to execute' } },
  handler: async ({ query }) => {
    // Your database logic here
    return { result: '42 rows returned' };
  },
});

const provider = createCopilot({
  tools: [dbQueryTool],
});

const result = await generateText({
  model: provider('default'),
  prompt: 'How many users signed up this week?',
});
```

### Tool Filtering

```typescript
import { createCopilot } from 'copilot-sdk-provider';

// Whitelist: only allow specific tools
const restricted = createCopilot({
  availableTools: ['read_file', 'list_directory'],
});

// Blacklist: exclude dangerous tools
const safe = createCopilot({
  excludedTools: ['run_terminal_command', 'write_file'],
});
```

### Permission & User Input Handlers

```typescript
import { createCopilot } from 'copilot-sdk-provider';

const provider = createCopilot({
  // Custom permission handler (default: approveAll)
  onPermissionRequest: async (request) => {
    console.log(`Permission requested: ${request.tool} on ${request.path}`);
    return { allowed: true };
  },

  // Handle ask_user requests from the agent
  onUserInputRequest: async (request) => {
    // In a web app, you'd relay this to the frontend
    return { response: 'Yes, proceed with the refactoring.' };
  },
});
```

### Verbose Logging

```typescript
import { createCopilot } from 'copilot-sdk-provider';

const provider = createCopilot({
  verbose: true, // Logs to console

  // Or provide a custom logger
  logger: {
    debug: (msg) => myLogger.debug(msg),
    info: (msg) => myLogger.info(msg),
    warn: (msg) => myLogger.warn(msg),
    error: (msg) => myLogger.error(msg),
  },
});
```

## API Reference

### `createCopilot(options?)`

Creates a new provider instance.

```typescript
const provider = createCopilot(options);
const model = provider('default');       // callable as function
const model = provider.chat('default');  // or via .chat()
const model = provider.languageModel('default'); // or via .languageModel()
```

### `copilot`

Default provider instance (reads `GITHUB_TOKEN` from environment).

```typescript
import { copilot } from 'copilot-sdk-provider';
const model = copilot('default');
```

### Model IDs

| ID | Description |
|----|-------------|
| `'default'` | Uses Copilot's default model assignment |
| `'gpt-4'` | Specific model (if available to your subscription) |
| `'claude-sonnet-4.6'` | Specific model (if available to your subscription) |
| Any string | Passed to the Copilot session as the model identifier |

### Settings (`CopilotSettings`)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `token` | `string` | `process.env.GITHUB_TOKEN` | GitHub authentication token |
| `cwd` | `string` | Inherited | Working directory for tool operations |
| `model` | `string` | — | Override model for the session |
| `systemPrompt` | `string` | — | Replace Copilot's system prompt |
| `tools` | `Tool[]` | — | Custom SDK tools to register |
| `availableTools` | `string[]` | — | Whitelist of allowed tool names |
| `excludedTools` | `string[]` | — | Blacklist of excluded tool names |
| `onPermissionRequest` | `PermissionHandler` | `approveAll` | Handler for permission requests |
| `onUserInputRequest` | `UserInputHandler` | — | Handler for user input requests |
| `onElicitationRequest` | `function` | — | Handler for elicitation (form) requests |
| `hooks` | `SessionHooks` | — | Session lifecycle hooks |
| `maxTurnTimeout` | `number` | `300_000` (5 min) | Timeout for `sendAndWait()` in ms |
| `clientOptions` | `CopilotClientOptions` | — | Options passed to `CopilotClient` constructor |
| `sessionConfig` | `Partial<SessionConfig>` | — | Additional session configuration |
| `verbose` | `boolean` | `false` | Enable debug logging |
| `logger` | `CopilotLogger` | Console/silent | Custom logger implementation |

### Exports

```typescript
// Provider
export { createCopilot, copilot } from 'copilot-sdk-provider';
export type { CopilotProvider, CopilotProviderOptions } from 'copilot-sdk-provider';

// Language model
export { CopilotLanguageModel } from 'copilot-sdk-provider';

// Types
export type { CopilotSettings, CopilotModelId, CopilotLogger } from 'copilot-sdk-provider';

// Utilities
export { convertMessages, mapFinishReason } from 'copilot-sdk-provider';
export { getLogger, consoleLogger, silentLogger } from 'copilot-sdk-provider';

// Errors
export {
  createAuthError, createTimeoutError, createSDKError,
  isAuthError, isTimeoutError, isRetryableError,
} from 'copilot-sdk-provider';
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Your Application                   │
│                                                 │
│   generateText({ model: copilot('default') })   │
│                     │                           │
│            ┌────────▼────────┐                  │
│            │ CopilotProvider │ ← ProviderV3     │
│            └────────┬────────┘                  │
│            ┌────────▼────────────┐              │
│            │ CopilotLanguageModel│ ← LMV3       │
│            │  • doGenerate()     │              │
│            │  • doStream()       │              │
│            └────────┬────────────┘              │
│                     │ creates per-call          │
│            ┌────────▼────────┐                  │
│            │  CopilotClient  │ ← SDK            │
│            │  CopilotSession │                  │
│            └────────┬────────┘                  │
│                     │ JSON-RPC                  │
│            ┌────────▼────────┐                  │
│            │  Copilot CLI    │ ← subprocess     │
│            │  (local agent)  │                  │
│            └────────┬────────┘                  │
│                     │ HTTPS                     │
│            ┌────────▼────────┐                  │
│            │  GitHub Copilot │ ← cloud          │
│            │  Backend        │                  │
│            └─────────────────┘                  │
└─────────────────────────────────────────────────┘
```

Each call to `doGenerate()` or `doStream()` creates a fresh `CopilotClient` → `CopilotSession` pair. The session manages conversation state, tool execution, and the agent loop internally.

## Streaming Behavior

The provider supports both `generateText()` and `streamText()`. However, the current Copilot SDK delivers responses as a **single complete message** rather than incremental token-by-token deltas.

**What this means in practice:**
- `streamText()` **works correctly** — it returns a valid `ReadableStream` of `LanguageModelV3StreamPart`
- The text arrives as **one chunk** at the end of processing, not progressively token-by-token
- For the end user, the experience is similar to `generateText()` but wrapped in the streaming API
- Tool execution events (`tool-call`, `tool-result`) ARE emitted in real-time as the agent works
- Reasoning events (`reasoning-start`, `reasoning-delta`) are emitted when available

**Why?** The Copilot SDK communicates with a local CLI subprocess via JSON-RPC. The subprocess delivers the final `assistant.message` event after completing its full agent loop (which may include multiple tool calls). The `assistant.message_delta` event type exists in the SDK types but is not currently emitted by the backend.

This is a Copilot SDK behavior, not a limitation of this provider. When the SDK adds granular streaming support, this provider will automatically benefit — the event handlers are already wired.

## Limitations

| Limitation | Details |
|-----------|---------|
| **No incremental text streaming** | Text arrives as one chunk (see [Streaming Behavior](#streaming-behavior)) |
| **No embedding model** | `provider.embeddingModel()` throws `NoSuchModelError` |
| **No image model** | `provider.imageModel()` throws `NoSuchModelError` |
| **No image input** | `supportsImageUrls` is `false` |
| **No structured outputs** | `supportsStructuredOutputs` is `false`; `defaultObjectGenerationMode` is `'json'` |
| **Caller-defined tools ignored** | AI SDK `tools` parameter is ignored; use SDK tools via `settings.tools` |
| **No `toolChoice`** | The Copilot agent decides tool usage autonomously |
| **Session-per-call** | Each `doGenerate`/`doStream` creates a new session (no session reuse yet) |
| **Copilot subscription required** | Needs an active GitHub Copilot subscription |
| **Local subprocess** | Runs a local Copilot CLI process (not a pure HTTP API call) |

## Comparison with Other Providers

| Feature | OpenAI/Anthropic Providers | This Provider |
|---------|---------------------------|---------------|
| Communication | HTTP API | Local subprocess (JSON-RPC) |
| Streaming | Token-by-token | Single chunk (SDK limitation) |
| Tools | Caller-defined | SDK-managed (agentic) |
| Tool execution | Returned to caller | Executed by the agent |
| Auth | API key | GitHub token |
| Model selection | Explicit model IDs | `'default'` or specific ID |
| State | Stateless | Session-based (per call) |

## Error Handling

The provider throws typed errors:

```typescript
import { isAuthError, isTimeoutError, isRetryableError } from 'copilot-sdk-provider';

try {
  const result = await generateText({ model: copilot('default'), prompt: '...' });
} catch (error) {
  if (isAuthError(error)) {
    // Missing or invalid GITHUB_TOKEN
  } else if (isTimeoutError(error)) {
    // sendAndWait exceeded maxTurnTimeout
  } else if (isRetryableError(error)) {
    // Transient error (ECONNREFUSED, ETIMEDOUT, etc.)
  }
}
```

## Running Tests

```bash
# Unit tests (75 tests, mocked SDK)
npm test

# Integration tests (requires GITHUB_TOKEN + active Copilot subscription)
GITHUB_TOKEN=$(gh auth token) npx tsx examples/integration-test.ts
```

## Contributing

Contributions are welcome! Please open an issue or PR on the [GitHub repository](https://github.com/rubenhig/copilot-sdk-provider).

### Development

```bash
git clone https://github.com/rubenhig/copilot-sdk-provider.git
cd copilot-sdk-provider
npm install
npm run build
npm test
```

## Related

- [Vercel AI SDK](https://ai-sdk.dev) — The AI framework this provider integrates with
- [GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk) — The underlying SDK
- [AI SDK Custom Providers Guide](https://ai-sdk.dev/providers/community-providers/custom-providers) — How to build providers
- [Community Providers](https://ai-sdk.dev/providers/community-providers) — Other community-built providers

## License

[MIT](./LICENSE) © rubenhig
