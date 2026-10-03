// generate-resumes: render the canonical resume (Life vault markdown) to
// every surface: master PDF (with phone), redacted public PDF (site repo),
// and a redacted standalone markdown artifact. Layout is this repo's theme
// (EB Garamond, date columns, no monogram); the HTML-to-PDF machinery is the
// tools repo's shared pdf-engine (TOOLS_HOME), the same engine doc-to-pdf
// prints with. No rendering logic is duplicated here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  linesForArtifacts,
  matchOrg,
  matchRole,
  matchCert,
  matchProjectMeta,
  tenureSpan,
  type ProjectMeta,
} from '../grammar.ts';

// The surface of the tools repo's pdf-engine (lib/pdf-engine/index.ts) this
// renderer uses; it is resolved from TOOLS_HOME at run time.
interface PdfEngine {
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

interface Role {
  title: string;
  dates: string;
  bullets: string[];
}

interface Org {
  name: string;
  location: string;
  roles: Role[];
}

interface Project {
  title: string;
  meta: ProjectMeta | null;
  bullets: string[];
}

interface Section {
  title: string;
  orgs: Org[];
  items: string[];
  projects: Project[];
}

interface Identity {
  name: string;
  email: string;
  linkedin: string;
  github: string;
  website: string;
  location: string;
  phone?: string;
}

const repoHome = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeHome = process.env.CODE_HOME || path.join(os.homedir(), 'Code');
const toolsHome = process.env.TOOLS_HOME || path.join(codeHome, 'Assets', 'tools');
const lifeHome = process.env.LIFE_HOME || path.join(os.homedir(), 'Documents', 'Life');
const careerHome = process.env.CAREER_HOME || path.join(os.homedir(), 'Documents', 'Career');
const siteHome = process.env.SITE_HOME || path.join(codeHome, 'Projects', 'jseverino.com');

function die(msg: string): never {
  console.error(`generate-resumes: ${msg}`);
  process.exit(1);
}

const SPEC = {
  ok: true,
  schema_version: 4,
  name: 'generate-resumes',
  description: 'Render the canonical resume markdown to the master PDF, the public redacted PDF, and a markdown artifact.',
  group: 'Authoring',
  order: 171,
  effect: 'local_write',
  global_options: [],
  paras: [
    'The canonical source is the Life vault resume (LIFE_HOME/Career/resume.md). Outputs: master PDF with phone into CAREER_HOME/Resumes/, redacted PDF into the site repo public/assets/docs/, and a redacted standalone markdown resume into CAREER_HOME/Resumes/.',
    'Typesetting is EB Garamond (vendored, OFL) on US Letter, one page enforced via pdfinfo when available. The HTML-to-PDF engine is the shared lib/pdf-engine, the same one doc-to-pdf uses.',
  ],
  examples: ['generate-resumes', 'generate-resumes --input ~/Documents/Life/Career/resume.md'],
  positionals: [],
  commands: [],
};

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args[0] === '--describe') {
  console.log(args.includes('--pretty') ? JSON.stringify(SPEC, null, 2) : JSON.stringify(SPEC));
  process.exit(0);
}
if (args[0] === '-h' || args[0] === '--help') {
  console.log(`Usage: generate-resumes [--input <resume.md>]\n${SPEC.description}`);
  process.exit(0);
}

let input = path.join(lifeHome, 'Career', 'resume.md');
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--input') {
    input = path.resolve(args[i + 1] || '');
    i += 1;
  } else {
    die(`unknown argument: ${args[i]}`);
  }
}
if (!fs.existsSync(input)) die(`canonical resume not found: ${input}`);

const enginePath = path.join(toolsHome, 'lib', 'pdf-engine', 'index.ts');
if (!fs.existsSync(enginePath)) die(`tools pdf-engine not found: ${enginePath} (set TOOLS_HOME)`);
const { fileDataUrl, htmlText, findChromium, printHtmlToPdf } = (await import(enginePath)) as PdfEngine;

// ---------------------------------------------------------------------------
// Parse: frontmatter (contact identity) + the structured resume body.
// The parser is deliberately strict: an unrecognized body line kills the
// render, so content drift in the canonical gets caught here, not on paper.
// ---------------------------------------------------------------------------

const raw = fs.readFileSync(input, 'utf8');
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
if (!fmMatch) die('canonical resume has no frontmatter');
const fields: Record<string, string> = {};
for (const line of (fmMatch[1] ?? '').split('\n')) {
  const kv = line.match(/^([a-z_]+):\s*(.+)$/);
  if (!kv) continue;
  const [, key = '', value = ''] = kv;
  if (!/^[>|]/.test(value.trim())) fields[key] = value.trim().replace(/^['"]|['"]$/g, '');
}
function field(key: string): string {
  const value = fields[key];
  if (!value) die(`frontmatter is missing "${key}"`);
  return value;
}
const frontmatter: Identity = {
  name: field('name'),
  email: field('email'),
  linkedin: field('linkedin'),
  github: field('github'),
  website: field('website'),
  location: field('location'),
  ...(fields.phone ? { phone: fields.phone } : {}),
};

function absoluteHref(href: string): string {
  return href.startsWith('/') ? `https://${frontmatter.website}${href}` : href;
}

function inlineHtml(text: string): string {
  return htmlText(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_: string, label: string, href: string) => `<a href="${absoluteHref(href)}">${label}</a>`);
}

const body = linesForArtifacts(raw.slice(fmMatch[0].length).split('\n'));
const sections: Section[] = [];
let section: Section | null = null;
let org: Org | null = null;
let role: Role | null = null;
let project: Project | null = null;

for (const [n, line] of body.entries()) {
  const trimmed = line.trim();

  if (!trimmed || trimmed === '---') continue;
  if (trimmed.startsWith('<p')) continue;

  const h2 = trimmed.match(/^##\s+(.+)$/);
  if (h2) {
    section = { title: h2[1] ?? '', orgs: [], items: [], projects: [] };
    sections.push(section);
    org = role = project = null;
    continue;
  }
  if (!section) die(`content before first section (line ${n + 1}): ${trimmed}`);

  const h3 = trimmed.match(/^###\s+(.+)$/);
  if (h3) {
    const located = matchOrg(trimmed);
    if (located) {
      org = { name: located.name, location: located.location, roles: [] };
      section.orgs.push(org);
      role = project = null;
    } else {
      project = { title: h3[1] ?? '', meta: null, bullets: [] };
      section.projects.push(project);
      org = role = null;
    }
    continue;
  }

  const roleLine = matchRole(trimmed);
  if (roleLine && org) {
    role = { title: roleLine.title, dates: roleLine.dates, bullets: [] };
    org.roles.push(role);
    continue;
  }

  const projectMeta = matchProjectMeta(trimmed);
  if (projectMeta && project) {
    project.meta = projectMeta;
    continue;
  }

  const bullet = trimmed.match(/^-\s+(.+)$/);
  if (bullet) {
    const text = bullet[1] ?? '';
    if (project) project.bullets.push(text);
    else if (role) role.bullets.push(text);
    else if (!org) section.items.push(text);
    else die(`bullet without a home (line ${n + 1}): ${trimmed}`);
    continue;
  }

  die(`unrecognized line ${n + 1}: ${trimmed}`);
}

// ---------------------------------------------------------------------------
// Theme: US Letter, one page, EB Garamond, date columns.
// ---------------------------------------------------------------------------

const brandHome = process.env.BRAND_HOME || path.join(codeHome, 'Assets', 'severino-brand');
const brandKit = path.resolve(
  process.env.RESUME_BRAND_KIT || process.env.DOCTOPDF_BRAND_KIT || path.join(brandHome, 'kits', 'joe-severino'),
);
let brandTokens = '';
try {
  brandTokens = fs.readFileSync(path.join(brandKit, 'web', 'tokens.css'), 'utf8');
} catch {
  die(`brand tokens not found: ${path.join(brandKit, 'web', 'tokens.css')}`);
}
const garamond = fileDataUrl(path.join(repoHome, 'lib', 'fonts', 'eb-garamond-variable-latin.woff2'), 'font/woff2');
const garamondItalic = fileDataUrl(
  path.join(repoHome, 'lib', 'fonts', 'eb-garamond-italic-variable-latin.woff2'),
  'font/woff2',
);

// The header matches the original Word one-pager: identity links only, no
// location line. The city lives on the site page.
function contactLine(withPhone: boolean): string[] {
  return [
    frontmatter.email,
    ...(withPhone && frontmatter.phone ? [frontmatter.phone] : []),
    frontmatter.linkedin,
    frontmatter.github,
    frontmatter.website,
  ];
}

function renderCertItem(item: string): string {
  const cert = matchCert(item);
  if (cert) {
    return `<div class="row cert"><span><strong><a href="${cert.url}">${htmlText(cert.name)}</a></strong> – ${htmlText(cert.issuer)}</span><span class="dates">${htmlText(cert.date)}</span></div>`;
  }
  return `<div class="row cert"><span>${inlineHtml(item)}</span></div>`;
}

function renderSection(sec: Section): string {
  const parts = [`<section><h2>${htmlText(sec.title)}</h2>`];
  const plainSubLines = sec.title.trim().toUpperCase() === 'EDUCATION';

  for (const o of sec.orgs) {
    // Company row carries the summarized tenure; single-entry orgs (degrees)
    // show their dates here alone so nothing repeats.
    const span = tenureSpan(o.roles.map((r) => r.dates));
    parts.push(
      `<div class="row org"><span class="org-name">${htmlText(o.name)}</span><span class="dates">${htmlText(span)}</span></div>`,
    );
    for (const [i, r] of o.roles.entries()) {
      const dates = o.roles.length > 1 ? ` <span class="role-dates">(${htmlText(r.dates)})</span>` : '';
      const loc = i === 0 ? `<span class="org-loc">${htmlText(o.location)}</span>` : '';
      parts.push(
        `<div class="row role"><span><span class="role-title">${htmlText(r.title)}</span>${dates}</span>${loc}</div>`,
      );
      if (r.bullets.length) {
        if (plainSubLines) {
          parts.push(r.bullets.map((b) => `<div class="subline">${inlineHtml(b)}</div>`).join(''));
        } else {
          parts.push(`<ul>${r.bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join('')}</ul>`);
        }
      }
    }
  }

  for (const item of sec.items) parts.push(renderCertItem(item));

  for (const p of sec.projects) {
    const date = p.meta ? `<span class="dates">${htmlText(p.meta.date)}</span>` : '';
    parts.push(`<div class="row role project"><span class="role-title">${htmlText(p.title)}</span>${date}</div>`);
    if (p.meta) {
      parts.push(`<div class="subline project-link"><a href="${absoluteHref(p.meta.href)}">${htmlText(p.meta.label)}</a></div>`);
    }
    if (p.bullets.length) parts.push(`<ul>${p.bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join('')}</ul>`);
  }

  parts.push('</section>');
  return parts.join('\n');
}

function renderHtml(withPhone: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${htmlText(frontmatter.name)} — Resume</title>
<style>
  ${brandTokens}
  @font-face {
    font-family: "EB Garamond";
    src: url("${garamond}") format("woff2");
    font-style: normal;
    font-weight: 400 800;
    font-display: block;
  }
  @font-face {
    font-family: "EB Garamond";
    src: url("${garamondItalic}") format("woff2");
    font-style: italic;
    font-weight: 400 800;
    font-display: block;
  }
  @page {
    size: Letter;
    margin: 9mm 12.5mm 11mm;
    @bottom-center {
      content: "generated by resume-engine · github.com/joeseverino/resume-engine";
      color: color-mix(in srgb, var(--brand-ink) 42%, var(--brand-paper));
      font: 7.5px "EB Garamond", Garamond, Georgia, serif;
    }
  }
  * { box-sizing: border-box; }
  body { font: 9.9pt/1.27 "EB Garamond", Garamond, Georgia, serif; color: var(--brand-ink); background: var(--brand-paper); margin: 0; }
  a { color: inherit; text-decoration: none; }
  header { text-align: center; margin-bottom: 2mm; }
  h1 { font-size: 19pt; font-weight: 700; letter-spacing: .01em; margin: 0 0 .6mm; color: var(--brand-deep); }
  .contact { font-size: 9.2pt; }
  .contact span + span::before { content: " | "; }
  h2 { font-size: 10pt; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; margin: 2.4mm 0 1mm; padding-bottom: .4mm; border-bottom: .6pt solid color-mix(in srgb, var(--brand-deep) 55%, var(--brand-paper)); color: var(--brand-deep); }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; }
  .org { margin-top: 1.6mm; }
  .org-name, .project .role-title, .cert strong { font-weight: 700; font-size: 10.4pt; }
  .org-loc { font-weight: 400; font-size: 9.4pt; }
  .role { margin-top: .8mm; }
  .role-title { font-weight: 600; }
  .role-dates { font-weight: 400; }
  .dates { white-space: nowrap; font-weight: 700; }
  ul { margin: .3mm 0 .9mm; padding-left: 4.6mm; }
  li { margin: 0 0 .35mm; padding-left: .3mm; }
  .subline { font-size: 9.4pt; margin: .2mm 0 .2mm 1.2mm; }
  .project-link { font-size: 9pt; color: color-mix(in srgb, var(--brand-ink) 72%, var(--brand-paper)); }
  .cert { margin: .45mm 0; }
</style></head>
<body>
<header>
  <h1>${htmlText(frontmatter.name)}</h1>
  <div class="contact">${contactLine(withPhone).map((p) => `<span>${htmlText(p)}</span>`).join('')}</div>
</header>
${sections.map(renderSection).join('\n')}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Markdown artifact: the redacted, standalone resume as clean markdown.
// ---------------------------------------------------------------------------

function renderMarkdown(): string {
  const lines = [`# ${frontmatter.name}`, '', contactLine(false).join(' | '), ''];
  for (const sec of sections) {
    lines.push(`## ${sec.title}`, '');
    for (const o of sec.orgs) {
      lines.push(`### ${o.name} — ${o.location}`, '');
      for (const r of o.roles) {
        lines.push(`**${r.title}** (${r.dates})`, '');
        for (const b of r.bullets) lines.push(`- ${b}`);
        if (r.bullets.length) lines.push('');
      }
    }
    for (const item of sec.items) lines.push(`- ${item}`);
    if (sec.items.length) lines.push('');
    for (const p of sec.projects) {
      lines.push(`### ${p.title}`, '');
      if (p.meta) lines.push(`[${p.meta.label}](${absoluteHref(p.meta.href)}) — ${p.meta.date}`, '');
      for (const b of p.bullets) lines.push(`- ${b}`);
      if (p.bullets.length) lines.push('');
    }
  }
  lines.push('---', '', '*generated by [resume-engine](https://github.com/joeseverino/resume-engine)*');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Render the three artifacts.
// ---------------------------------------------------------------------------

const chrome = findChromium(process.env.CHROME_PATH);
if (!chrome) die('no Chrome/Edge/Chromium found. Set CHROME_PATH to a Chromium binary.');

type Output =
  | { label: string; file: string; kind: 'pdf'; withPhone: boolean }
  | { label: string; file: string; kind: 'md' };

const outputs: Output[] = [
  {
    label: 'master PDF',
    file: path.join(careerHome, 'Resumes', 'joseph-severino-resume.pdf'),
    kind: 'pdf',
    withPhone: true,
  },
  {
    label: 'public PDF (redacted)',
    file: path.join(siteHome, 'public', 'assets', 'docs', 'joseph-severino-resume.pdf'),
    kind: 'pdf',
    withPhone: false,
  },
  {
    label: 'markdown artifact (redacted)',
    file: path.join(careerHome, 'Resumes', 'joseph-severino-resume.md'),
    kind: 'md',
  },
];

function assertOnePage(file: string, label: string): void {
  const result = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.warn(`generate-resumes: pdfinfo unavailable — skipped page-count check for ${label}`);
    return;
  }
  const pages = Number(result.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (pages !== 1) die(`${label} is ${pages} pages — the resume must fit one page. Trim the canonical.`);
}

for (const out of outputs) {
  fs.mkdirSync(path.dirname(out.file), { recursive: true });
  if (out.kind === 'md') {
    fs.writeFileSync(out.file, renderMarkdown());
  } else {
    try {
      printHtmlToPdf({
        chrome,
        html: renderHtml(out.withPhone),
        output: out.file,
        tmpPrefix: `generate-resumes-${out.withPhone ? 'master' : 'public'}`,
        keepHtml: !!process.env.RESUME_KEEP_HTML,
        onKeepHtml: (p) => console.log(`generate-resumes: kept HTML at ${p}`),
      });
    } catch (error) {
      die((error as Error).message);
    }
    assertOnePage(out.file, out.label);
  }
  const kb = Math.round(fs.statSync(out.file).size / 1024);
  console.log(`generate-resumes: wrote ${out.file} (${kb} KB, ${out.label})`);
}
