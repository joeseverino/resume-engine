// Shared command-line plumbing for the two tools: strict argument parsing with
// the tools' own error wording, and the --describe contract from cordon-spec.
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { SurfaceSpec } from 'cordon-spec/emit';

// Dispatchers pass a bare `--` before the tool's own flags; util.parseArgs
// would turn everything after it into positionals, so it is dropped first.
export function parseFlags<const O extends ParseArgsOptionsConfig>(
  options: O,
  argv: readonly string[],
  die: (message: string) => never,
) {
  const args = argv.filter((arg) => arg !== '--');
  let parsed;
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = message.match(/^Unknown option '([^']+)'/);
    return die(unknown ? `unknown argument: ${unknown[1]}` : message);
  }
  const [extra] = parsed.positionals;
  if (extra !== undefined) die(`unknown argument: ${extra}`);
  return parsed.values;
}

export async function printContract(spec: SurfaceSpec, pretty: boolean, die: (message: string) => never): Promise<never> {
  let emit: typeof import('cordon-spec/emit');
  try {
    emit = await import('cordon-spec/emit');
  } catch {
    return die('--describe needs cordon-spec (a dev dependency): run npm ci');
  }
  const contract = emit.renderSurface(spec);
  console.log(pretty ? JSON.stringify(contract, null, 2) : JSON.stringify(contract));
  process.exit(0);
}
