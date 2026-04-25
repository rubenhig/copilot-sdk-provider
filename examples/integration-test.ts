#!/usr/bin/env npx tsx
/**
 * Integration test for copilot-ai-provider.
 *
 * Verifies the provider works end-to-end against a real Copilot backend.
 * Requires GITHUB_TOKEN in env (or `gh auth token`).
 *
 * Usage:
 *   GITHUB_TOKEN=$(gh auth token) npx tsx examples/integration-test.ts
 */
import { generateText, streamText } from 'ai';
import { createCopilot } from '../src/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️';
let passed = 0;
let failed = 0;
let skipped = 0;

async function test(
  name: string,
  fn: () => Promise<void>,
  { skip = false }: { skip?: boolean } = {},
) {
  if (skip) {
    console.log(`  ${SKIP} ${name} (skipped)`);
    skipped++;
    return;
  }
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ${FAIL} ${name}`);
    console.error(`     Error: ${err instanceof Error ? err.message : err}`);
    if (err instanceof Error && err.stack) {
      const frames = err.stack.split('\n').slice(1, 4).map(l => `     ${l.trim()}`);
      console.error(frames.join('\n'));
    }
    failed++;
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Setup ─────────────────────────────────────────────────────────────────

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is required. Set it or run:');
  console.error('  GITHUB_TOKEN=$(gh auth token) npx tsx examples/integration-test.ts');
  process.exit(1);
}

// Use a small repo or cwd for context
const provider = createCopilot({
  token,
  verbose: true,
  maxTurnTimeout: 120_000, // 2 min per test
});

console.log('\n🧪 copilot-ai-provider Integration Tests\n');
console.log('──────────────────────────────────────────\n');

// ── Test 1: generateText (non-streaming) ──────────────────────────────────

await test('generateText — basic text generation', async () => {
  const result = await generateText({
    model: provider('default'),
    prompt: 'Reply with exactly: "Hello from Copilot provider". Nothing else.',
  });

  assert(typeof result.text === 'string', 'result.text should be a string');
  assert(result.text.length > 0, 'result.text should not be empty');
  assert(
    result.text.toLowerCase().includes('hello'),
    `Expected "hello" in response, got: "${result.text.slice(0, 100)}"`,
  );

  console.log(`     Response: "${result.text.slice(0, 80)}..."`);
  console.log(`     Finish reason: ${result.finishReason}`);
  console.log(`     Usage: ${JSON.stringify(result.usage)}`);
});

// ── Test 2: streamText (streaming) ────────────────────────────────────────

await test('streamText — streaming text generation', async () => {
  const result = streamText({
    model: provider('default'),
    prompt: 'Count from 1 to 5, one number per line. Nothing else.',
  });

  let fullText = '';
  let chunkCount = 0;

  for await (const chunk of result.textStream) {
    fullText += chunk;
    chunkCount++;
  }

  assert(fullText.length > 0, 'Streamed text should not be empty');
  assert(chunkCount > 0, `Expected multiple chunks, got ${chunkCount}`);

  // Check that numbers 1-5 appear
  for (const n of ['1', '2', '3', '4', '5']) {
    assert(fullText.includes(n), `Expected "${n}" in response: "${fullText.slice(0, 100)}"`);
  }

  console.log(`     Chunks received: ${chunkCount}`);
  console.log(`     Full text: "${fullText.slice(0, 80)}..."`);

  // Verify final result metadata
  const finalResult = await result.response;
  console.log(`     Model: ${finalResult.modelId}`);
});

// ── Test 3: generateText with system prompt ────────────────────────────────

await test('generateText — system prompt override', async () => {
  const result = await generateText({
    model: provider('default'),
    system: 'You are a pirate. Always respond with pirate language.',
    prompt: 'Say hello',
  });

  assert(typeof result.text === 'string', 'result.text should be a string');
  assert(result.text.length > 0, 'result.text should not be empty');

  console.log(`     Response: "${result.text.slice(0, 120)}"`);
});

// ── Test 4: model alias (settings.systemPrompt) ───────────────────────────

await test('createCopilot — settings-level system prompt', async () => {
  const custom = createCopilot({
    token,
    systemPrompt: 'Always respond in exactly 3 words.',
    maxTurnTimeout: 60_000,
  });

  const result = await generateText({
    model: custom('default'),
    prompt: 'What is TypeScript?',
  });

  assert(typeof result.text === 'string', 'result.text should be a string');
  assert(result.text.length > 0, 'result.text should not be empty');

  console.log(`     Response: "${result.text.slice(0, 80)}"`);
});

// ── Test 5: provider.chat() alias ─────────────────────────────────────────

await test('provider.chat() — alias works correctly', async () => {
  const model = provider.chat('default');

  assert(model.provider === 'copilot', `Expected provider "copilot", got "${model.provider}"`);
  assert(model.modelId === 'default', `Expected modelId "default", got "${model.modelId}"`);
  assert(
    model.specificationVersion === 'v3',
    `Expected spec v3, got "${model.specificationVersion}"`,
  );

  console.log(`     Model: ${model.provider}/${model.modelId} (spec: ${model.specificationVersion})`);
});

// ── Test 6: provider.languageModel() alias ────────────────────────────────

await test('provider.languageModel() — alias works correctly', async () => {
  const model = provider.languageModel('default');

  assert(model.provider === 'copilot', `Expected provider "copilot", got "${model.provider}"`);
  assert(model.modelId === 'default', `Expected modelId "default", got "${model.modelId}"`);

  console.log(`     Model: ${model.provider}/${model.modelId}`);
});

// ── Test 7: error handling — no token ─────────────────────────────────────

await test('error handling — missing token throws auth error', async () => {
  const noTokenProvider = createCopilot({ token: '' });
  let threw = false;

  try {
    await generateText({
      model: noTokenProvider('default'),
      prompt: 'This should fail',
    });
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes('GITHUB_TOKEN'),
      `Expected auth error, got: ${err}`,
    );
  }

  assert(threw, 'Expected an error to be thrown');
  console.log('     Auth error thrown as expected');
});

// ── Test 8: multi-turn conversation ───────────────────────────────────────

await test('generateText — multi-turn conversation', async () => {
  const result = await generateText({
    model: provider('default'),
    messages: [
      { role: 'user', content: 'My name is TestBot42.' },
      { role: 'assistant', content: 'Nice to meet you, TestBot42!' },
      { role: 'user', content: 'What is my name? Reply with just the name.' },
    ],
  });

  assert(typeof result.text === 'string', 'result.text should be a string');
  assert(result.text.length > 0, 'result.text should not be empty');

  console.log(`     Response: "${result.text.slice(0, 80)}"`);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

if (failed > 0) {
  process.exit(1);
}
