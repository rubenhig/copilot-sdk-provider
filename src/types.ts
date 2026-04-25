/**
 * Settings for the Copilot AI provider.
 *
 * These are passed when creating a model instance via `createCopilot()` or
 * the `copilot()` factory function.
 */
import type {
  Tool,
  SessionConfig,
  PermissionHandler,
  CopilotClientOptions,
} from '@github/copilot-sdk';

/** Extracted from SessionConfig since the SDK doesn't export this directly. */
type UserInputHandler = NonNullable<SessionConfig['onUserInputRequest']>;

/**
 * Configuration for the Copilot language model.
 */
export interface CopilotSettings {
  /**
   * GitHub token for authentication.
   * Falls back to `process.env.GITHUB_TOKEN` if not provided.
   */
  token?: string;

  /**
   * Working directory for the Copilot session.
   * Tool operations (file reads, searches, etc.) are relative to this directory.
   */
  cwd?: string;

  /**
   * Model to use for the session (e.g., 'gpt-4', 'claude-sonnet-4.6').
   * If not provided, uses the Copilot default.
   */
  model?: string;

  /**
   * System prompt override.
   * When set, replaces the default Copilot system prompt entirely.
   */
  systemPrompt?: string;

  /**
   * Custom tools to expose to the Copilot session.
   * These are SDK `Tool` objects created via `defineTool()`.
   */
  tools?: Tool<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Tool names to allow (whitelist). When specified, only these tools are available.
   */
  availableTools?: string[];

  /**
   * Tool names to exclude. All other tools remain available.
   * Ignored if `availableTools` is specified.
   */
  excludedTools?: string[];

  /**
   * Handler for permission requests from the Copilot agent.
   * Defaults to `approveAll` if not provided.
   */
  onPermissionRequest?: PermissionHandler;

  /**
   * Handler for user input requests (ask_user).
   * When provided, enables the agent to ask questions to the user.
   */
  onUserInputRequest?: UserInputHandler;

  /**
   * Handler for elicitation requests (form-based UI dialogs).
   * Available when the Copilot SDK version supports it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onElicitationRequest?: any;

  /**
   * Hook handlers for session lifecycle events.
   */
  hooks?: SessionConfig['hooks'];

  /**
   * Timeout in milliseconds for `sendAndWait()`.
   * @default 300_000 (5 minutes)
   */
  maxTurnTimeout?: number;

  /**
   * Additional options passed to `CopilotClient` constructor.
   */
  clientOptions?: Partial<CopilotClientOptions>;

  /**
   * Additional session config options merged into `createSession()`.
   */
  sessionConfig?: Partial<Omit<SessionConfig, 'onPermissionRequest' | 'tools' | 'systemMessage' | 'workingDirectory'>>;

  /**
   * Enable verbose logging.
   * @default false
   */
  verbose?: boolean;

  /**
   * Custom logger. When provided, overrides the default console logger.
   */
  logger?: CopilotLogger;
}

/**
 * Logger interface for the provider.
 */
export interface CopilotLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Supported model IDs.
 * 'default' uses whatever model Copilot assigns.
 * Any other string is passed as the model to the session config.
 */
export type CopilotModelId = 'default' | (string & {});
