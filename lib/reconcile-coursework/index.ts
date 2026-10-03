// reconcile-coursework: rewrite each institution's "Relevant Coursework" line
// in the canonical resume from the education vault's governed export
// (`severino-edu-mcp export`), so completed coursework is authored once, in
// the course's own frontmatter. Completed courses only: the resume never
// lists in-progress work; the site's /education/ pages do. Display names
// prefer the vault's `short_title` (one-page fit) over the catalog title.
// Institutions without a vault presence are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { matchOrg } from '../grammar.ts';

// The slice of the education export this command reads.
interface Course {
  code: string;
  title: string;
  short_title?: string | null;
  status: string;
}

interface Institution {
  institution: string;
  courses: Course[];
}

interface EducationExport {
  ok: boolean;
  errors?: string[];
  institutions: Institution[];
}

const lifeHome = process.env.LIFE_HOME || path.join(os.homedir(), 'Documents', 'Life');

function die(msg: string): never {
  console.error(`reconcile-coursework: ${msg}`);
  process.exit(1);
}

const SPEC = {
  ok: true,
  schema_version: 4,
  name: 'reconcile-coursework',
  description:
    'Rewrite the canonical resume’s "Relevant Coursework" lines from the education vault’s governed export.',
  group: 'Authoring',
  order: 172,
  effect: 'local_write',
  global_options: [],
  paras: [
    'Reads `severino-edu-mcp export` (the same dataset behind the site’s /education/ pages) and rewrites each exported institution’s "- Relevant Coursework:" line in LIFE_HOME/Career/resume.md: completed courses only, in term order, `short_title` preferred over the catalog title. Trailing surface markers on the line are preserved; institutions with no vault presence are left alone.',
    'With --check, reports drift and exits 1 without writing — the verify face for rb-update-resume.',
  ],
  examples: ['reconcile-coursework', 'reconcile-coursework --check'],
  positionals: [],
  commands: [],
};

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args[0] === '--describe') {
  console.log(args.includes('--pretty') ? JSON.stringify(SPEC, null, 2) : JSON.stringify(SPEC));
  process.exit(0);
}
if (args[0] === '-h' || args[0] === '--help') {
  console.log(`Usage: reconcile-coursework [--input <resume.md>] [--check]\n${SPEC.description}`);
  process.exit(0);
}

let input = path.join(lifeHome, 'Career', 'resume.md');
let check = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--input') {
    input = path.resolve(args[i + 1] || '');
    i += 1;
  } else if (args[i] === '--check') {
    check = true;
  } else {
    die(`unknown argument: ${args[i]}`);
  }
}

if (!fs.existsSync(input)) die(`canonical resume not found: ${input}`);

let dataset: EducationExport;
try {
  dataset = JSON.parse(execFileSync('severino-edu-mcp', ['export'], { encoding: 'utf8' })) as EducationExport;
} catch (error) {
  const { stderr, message } = error as { stderr?: Buffer | string; message: string };
  die(`education export failed: ${stderr?.toString().trim() || message}`);
}
if (dataset.ok !== true) die(`education export failed:\n  ${(dataset.errors ?? []).join('\n  ')}`);

function courseworkLine(institution: Institution): string | null {
  const completed = institution.courses.filter((course) => course.status === 'completed');
  if (completed.length === 0) return null;
  const entries = completed.map(
    (course) => `${course.code.replace(/(\d)/, ' $1')} - ${course.short_title ?? course.title}`,
  );
  return `- Relevant Coursework: ${entries.join(', ')}`;
}

const lines = fs.readFileSync(input, 'utf8').split('\n');
const changed: string[] = [];

for (const institution of dataset.institutions) {
  const line = courseworkLine(institution);
  if (line === null) continue;

  const orgIndex = lines.findIndex((entry) => matchOrg(entry)?.name === institution.institution);
  if (orgIndex === -1) die(`institution "${institution.institution}" not found in ${input}`);

  let lineIndex = -1;
  for (const [i, entry] of lines.entries()) {
    if (i <= orgIndex) continue;
    if (/^#{2,3} /.test(entry)) break;
    if (entry.startsWith('- Relevant Coursework:')) {
      lineIndex = i;
      break;
    }
  }
  const current = lines[lineIndex];
  if (current === undefined) {
    die(`no "- Relevant Coursework:" line under "${institution.institution}" in ${input}`);
  }

  const marker = current.match(/\s(<!--[a-z-]+-->)\s*$/)?.[1];
  const next = marker ? `${line} ${marker}` : line;
  if (current !== next) {
    lines[lineIndex] = next;
    changed.push(institution.institution);
  }
}

if (changed.length === 0) {
  console.log('reconcile-coursework: canonical already in sync');
  process.exit(0);
}
if (check) {
  console.error(`reconcile-coursework: coursework drift under ${changed.join(', ')} — run reconcile-coursework to apply`);
  process.exit(1);
}
fs.writeFileSync(input, lines.join('\n'));
console.log(`reconcile-coursework: updated ${changed.join(', ')} in ${input}`);
