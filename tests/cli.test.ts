import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../lib/cli.ts';

const options = {
  check: { type: 'boolean' },
  input: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

function die(message: string): never {
  throw new Error(message);
}

test('parses flags and values', () => {
  assert.deepEqual({ ...parseFlags(options, ['--input', 'a.md', '--check'], die) }, { input: 'a.md', check: true });
});

test('a bare -- from a dispatcher is ignored', () => {
  assert.deepEqual({ ...parseFlags(options, ['--', '--check'], die) }, { check: true });
});

test('the last repeated value wins', () => {
  assert.equal(parseFlags(options, ['--input', 'a', '--input', 'b'], die).input, 'b');
});

test('unknown flags and positionals read as unknown arguments', () => {
  assert.throws(() => parseFlags(options, ['--bogus'], die), { message: 'unknown argument: --bogus' });
  assert.throws(() => parseFlags(options, ['extra'], die), { message: 'unknown argument: extra' });
});

test('a flag missing its value is rejected', () => {
  assert.throws(() => parseFlags(options, ['--input'], die), /argument missing/);
});
