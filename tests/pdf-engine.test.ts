import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPdfEngine } from '../lib/pdf-engine.ts';

function engineFile(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-engine-test-'));
  const file = path.join(dir, 'index.ts');
  fs.writeFileSync(file, source);
  return file;
}

const valid = `
export function fileDataUrl(file, mediaType) { return file + mediaType; }
export function htmlText(value) { return value; }
export function findChromium(explicitPath) { return explicitPath ?? null; }
export function printHtmlToPdf(options) {}
`;

test('loads a module that matches the expected surface', async () => {
  const engine = await loadPdfEngine(engineFile(valid));
  assert.equal(engine.htmlText('x'), 'x');
});

test('a missing engine fails with the TOOLS_HOME hint', async () => {
  await assert.rejects(loadPdfEngine('/nonexistent/pdf-engine.ts'), /not found.*set TOOLS_HOME/);
});

test('a missing export is named', async () => {
  const file = engineFile(valid.replace('export function htmlText(value) { return value; }', ''));
  await assert.rejects(loadPdfEngine(file), /htmlText is not exported as a function/);
});

test('a changed arity is named', async () => {
  const file = engineFile(valid.replace('fileDataUrl(file, mediaType)', 'fileDataUrl(file)'));
  await assert.rejects(loadPdfEngine(file), /fileDataUrl takes 1 parameters, expected 2/);
});

test('a module that throws on load is reported', async () => {
  await assert.rejects(loadPdfEngine(engineFile('throw new Error("boom");')), /failed to load.*boom/);
});
