// The resume grammar: the single definition of the canonical's line shapes,
// surface-marker semantics, and tenure-span math. Both renderers consume it:
// generate-resumes in this repo, and the site repo's sync-content (which
// imports this module locally to emit the /resume/ page rows). Line shapes
// change here and in the canonical together; nowhere else.

export const SITE_ONLY = '<!--site-only-->';
export const PDF_ONLY = '<!--pdf-only-->';

export interface Org {
  name: string;
  location: string;
}

export interface Role {
  title: string;
  dates: string;
}

export interface Cert {
  name: string;
  url: string;
  date: string;
  issuer: string;
}

export interface ProjectMeta {
  label: string;
  href: string;
  date: string;
}

function surface(lines: readonly string[], dropMarker: string, stripMarker: string): string[] {
  return lines
    .filter((line) => !line.includes(dropMarker))
    .map((line) => line.split(stripMarker).join('').replace(/\s+$/, ''));
}

export function linesForArtifacts(lines: readonly string[]): string[] {
  return surface(lines, SITE_ONLY, PDF_ONLY);
}

export function linesForSite(lines: readonly string[]): string[] {
  return surface(lines, PDF_ONLY, SITE_ONLY);
}

// Every capture group below is mandatory, so the `= ''` defaults never apply;
// they only narrow the types.

export function matchOrg(line: string): Org | null {
  const m = line.match(/^### (.+?) — _(.+)_$/);
  if (!m) return null;
  const [, name = '', location = ''] = m;
  return { name, location };
}

export function matchRole(line: string): Role | null {
  const m = line.match(/^\*\*(.+?) \((.+)\)\*\*$/) || line.match(/^\*\*(.+?)\*\* \((.+)\)$/);
  if (!m) return null;
  const [, title = '', dates = ''] = m;
  return { title: title.trim(), dates: dates.trim() };
}

// Certification bullet content: "[Name](url) — Date — Issuer".
export function matchCert(text: string): Cert | null {
  const m = text.match(/^\[(.+?)\]\((.+?)\) — (.+?) — (.+)$/);
  if (!m) return null;
  const [, name = '', url = '', date = '', issuer = ''] = m;
  return { name, url, date, issuer };
}

// Project meta line: "[label](href) — Date".
export function matchProjectMeta(line: string): ProjectMeta | null {
  const m = line.match(/^\[(.+?)\]\((.+?)\) — (.+)$/);
  if (!m) return null;
  const [, label = '', href = '', date = ''] = m;
  return { label, href, date };
}

// Role date ranges for the org opening at lines[orgIndex], in document
// order (newest first), stopping at the next heading. Line-walking
// consumers (the site sync) use this so heading-boundary knowledge never
// leaves the grammar.
export function orgRoleDates(lines: readonly string[], orgIndex: number): string[] {
  const dates: string[] = [];
  for (const line of lines.slice(orgIndex + 1)) {
    if (/^#{2,3} /.test(line)) break;
    const role = matchRole(line);
    if (role) dates.push(role.dates);
  }
  return dates;
}

// Summarized org tenure from its roles' date ranges, newest role first
// (the canonical's order): earliest start – latest end.
export function tenureSpan(dates: readonly string[]): string {
  const latest = dates[0];
  const earliest = dates.at(-1);
  if (latest === undefined || earliest === undefined) return '';
  if (dates.length === 1) return latest;
  return `${(earliest.split('–')[0] ?? '').trim()} – ${(latest.split('–').at(-1) ?? '').trim()}`;
}
