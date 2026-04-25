import { describe, it, expect } from 'vitest';
import { mapFinishReason } from '../src/map-finish-reason.js';

describe('mapFinishReason', () => {
  it('maps completed=true to stop', () => {
    const result = mapFinishReason(true, false, false);
    expect(result).toEqual({ unified: 'stop', raw: 'completed' });
  });

  it('maps timedOut=true to other with raw timeout', () => {
    const result = mapFinishReason(false, true, false);
    expect(result).toEqual({ unified: 'other', raw: 'timeout' });
  });

  it('maps errored=true to error', () => {
    const result = mapFinishReason(false, false, true);
    expect(result).toEqual({ unified: 'error', raw: 'error' });
  });

  it('prioritizes error over timeout', () => {
    const result = mapFinishReason(false, true, true);
    expect(result).toEqual({ unified: 'error', raw: 'error' });
  });

  it('maps completed=false (empty response) to stop with raw empty', () => {
    const result = mapFinishReason(false, false, false);
    expect(result).toEqual({ unified: 'stop', raw: 'empty' });
  });
});
