// The resume grammar: the single definition of the canonical's line shapes,
// surface-marker semantics, and tenure-span math. Both renderers consume it —
// generate-resumes in this repo, and the site repo's sync-content (which
// imports this module locally to emit the /resume/ page rows). Line shapes
// change here and in the canonical together; nowhere else.

export const SITE_ONLY = '<!--site-only-->';
export const PDF_ONLY = '<!--pdf-only-->';

function surface(lines, dropMarker, stripMarker) {
  return lines
    .filter((line) => !line.includes(dropMarker))
    .map((line) => line.split(stripMarker).join('').replace(/\s+$/, ''));
}

export function linesForArtifacts(lines) {
  return surface(lines, SITE_ONLY, PDF_ONLY);
}

export function linesForSite(lines) {
  return surface(lines, PDF_ONLY, SITE_ONLY);
}

export function matchOrg(line) {
  const m = line.match(/^### (.+?) — _(.+)_$/);
  return m ? { name: m[1], location: m[2] } : null;
}

export function matchRole(line) {
  const m = line.match(/^\*\*(.+?) \((.+)\)\*\*$/) || line.match(/^\*\*(.+?)\*\* \((.+)\)$/);
  return m ? { title: m[1].trim(), dates: m[2].trim() } : null;
}

// Certification bullet content: "[Name](url) — Date — Issuer".
export function matchCert(text) {
  const m = text.match(/^\[(.+?)\]\((.+?)\) — (.+?) — (.+)$/);
  return m ? { name: m[1], url: m[2], date: m[3], issuer: m[4] } : null;
}

// Project meta line: "[label](href) — Date".
export function matchProjectMeta(line) {
  const m = line.match(/^\[(.+?)\]\((.+?)\) — (.+)$/);
  return m ? { label: m[1], href: m[2], date: m[3] } : null;
}

// Summarized org tenure from its roles' date ranges, newest role first
// (the canonical's order): earliest start – latest end.
export function tenureSpan(dates) {
  if (dates.length === 0) return '';
  if (dates.length === 1) return dates[0];
  return `${dates[dates.length - 1].split('–')[0].trim()} – ${dates[0].split('–').pop().trim()}`;
}
