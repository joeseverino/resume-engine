// The pdf-engine lives in the tools repo and is resolved from TOOLS_HOME at
// run time, so the compiler cannot check it. The loaded module is validated
// against PdfEngine instead, which turns a signature change there into a
// clear error at load.
import fs from 'node:fs';

export interface PdfEngine {
  fileDataUrl(file: string, mediaType: string): string;
  htmlText(value: string): string;
  findChromium(explicitPath?: string): string | null;
  printHtmlToPdf(options: {
    chrome: string;
    html: string;
    output: string;
    tmpPrefix?: string;
    keepHtml?: boolean;
    onKeepHtml?: (file: string) => void;
  }): void;
}

// Accepted parameter counts (Function.length) per export: [min, max].
const SURFACE = {
  fileDataUrl: [2, 2],
  htmlText: [1, 1],
  findChromium: [0, 1],
  printHtmlToPdf: [1, 1],
} as const satisfies Record<keyof PdfEngine, readonly [number, number]>;

export function isPdfEngine(value: unknown): value is PdfEngine {
  return problems(value).length === 0;
}

function problems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['module has no exports'];
  const found: string[] = [];
  for (const [name, [min, max]] of Object.entries(SURFACE)) {
    const member: unknown = Reflect.get(value, name);
    if (typeof member !== 'function') {
      found.push(`${name} is not exported as a function`);
    } else if (member.length < min || member.length > max) {
      found.push(`${name} takes ${member.length} parameters, expected ${min === max ? min : `${min} to ${max}`}`);
    }
  }
  return found;
}

export async function loadPdfEngine(enginePath: string): Promise<PdfEngine> {
  if (!fs.existsSync(enginePath)) {
    throw new Error(`tools pdf-engine not found: ${enginePath} (set TOOLS_HOME)`);
  }
  let loaded: unknown;
  try {
    loaded = await import(enginePath);
  } catch (error) {
    throw new Error(`tools pdf-engine failed to load: ${enginePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const found = problems(loaded);
  if (found.length > 0) {
    throw new Error(`tools pdf-engine at ${enginePath} does not match PdfEngine: ${found.join('; ')}`);
  }
  if (!isPdfEngine(loaded)) throw new Error(`tools pdf-engine at ${enginePath} is malformed`);
  return loaded;
}
