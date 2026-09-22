/**
 * Issues as repository files.
 *
 * One `_newsletter/<slug>.md` per issue, which is what makes the archive and
 * the teaser plain Jekyll rendering instead of an API call. The front matter is
 * written and read only by us, so the parser handles the small, flat subset we
 * emit rather than being a general YAML implementation.
 */

export const DIR = '_newsletter';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function pathFor(slug) {
  return `${DIR}/${slug}.md`;
}

export function slugify(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    // Keep Hebrew letters; they read better in a URL than a transliteration.
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return base || `issue-${Date.now()}`;
}

function unquote(value) {
  const trimmed = String(value).trim();
  if (trimmed.length > 1 && /^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed.length > 1 && /^".*"$/.test(trimmed)) return trimmed.slice(1, -1).replace(/\\"/g, '"');
  return trimmed;
}

function quote(value) {
  const text = String(value ?? '');
  // Single quotes keep Hebrew, colons and hashes intact without escaping.
  return `'${text.replace(/'/g, "''")}'`;
}

export function parse(slug, raw) {
  const match = FRONT_MATTER.exec(String(raw || ''));
  if (!match) return null;

  const fields = {};
  match[1].split(/\r?\n/).forEach((line) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return;

    const separator = line.indexOf(':');
    if (separator === -1) return;

    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
  });

  const recipients = Number.parseInt(fields.recipients, 10);

  return {
    slug,
    title: fields.title || '',
    subtitle: fields.subtitle || '',
    date: fields.date || '',
    thumbnail: fields.thumbnail || '',
    status: fields.status === 'sent' ? 'sent' : 'draft',
    sent_at: fields.sent_at || '',
    recipients: Number.isFinite(recipients) ? recipients : 0,
    promotional: fields.promotional !== 'false',
    // serialize() trims and adds the file's trailing newline back, so drop it
    // here too: otherwise every save through the editor grows a blank line.
    body: match[2].replace(/^\r?\n/, '').trimEnd(),
  };
}

export function serialize(issue) {
  const lines = [
    `title: ${quote(issue.title)}`,
    `subtitle: ${quote(issue.subtitle || '')}`,
    `date: ${issue.date}`,
  ];

  if (issue.thumbnail) lines.push(`thumbnail: ${quote(issue.thumbnail)}`);
  lines.push(`status: ${issue.status === 'sent' ? 'sent' : 'draft'}`);
  if (issue.sent_at) lines.push(`sent_at: ${issue.sent_at}`);
  if (issue.recipients) lines.push(`recipients: ${issue.recipients}`);
  if (issue.promotional === false) lines.push('promotional: false');

  // A draft still renders a page so it can be previewed and linked from the
  // mail we are about to send, but it must not be indexed or listed.
  if (issue.status !== 'sent') {
    lines.push('noindex: true');
    lines.push('sitemap: false');
  }

  return `---\n${lines.join('\n')}\n---\n\n${String(issue.body || '').trim()}\n`;
}

/** Applies editor input onto an existing issue (or a new one). */
export function normalize(input, existing) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title is required');

  const slug = String(input.slug || '').trim() || existing?.slug || slugify(title);

  return {
    slug,
    title,
    subtitle: String(input.subtitle || '').trim(),
    date: existing?.date || input.date || new Date().toISOString(),
    thumbnail: String(input.thumbnail || '').trim(),
    // An issue that went out stays sent no matter what the editor submits:
    // correcting a typo in the archive must not make it re-sendable.
    status: existing?.status === 'sent' ? 'sent' : 'draft',
    sent_at: existing?.sent_at || '',
    recipients: existing?.recipients || 0,
    promotional: input.promotional !== false,
    body: String(input.body || ''),
  };
}
