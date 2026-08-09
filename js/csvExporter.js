/**
 * Enhanced CSV Exporter with Validation and Platform-Specific Mapping
 */

function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Escape double quotes by doubling them
  str = str.replace(/"/g, '""');
  // Always quote for safety (handles commas, newlines, quotes)
  return `"${str}"`;
}

// ── Platform-specific CSV row builder ──────────────────────────────────────
export function formatRowForPlatform(item, platform) {
  const meta = item.metadata || {};
  const filename    = item.name || '';
  const title       = meta.title || '';
  const description = meta.description || title;
  const keywords    = Array.isArray(meta.keywords) ? meta.keywords.join(', ') : (meta.keywords || '');
  const category    = meta.category || '';

  switch (platform.id) {
    case 'adobe':
      return [csvCell(filename), csvCell(title), csvCell(keywords), csvCell(category)];

    case 'shutterstock':
      return [csvCell(filename), csvCell(description), csvCell(keywords), csvCell(category)];

    case 'freepik':
      return [csvCell(filename), csvCell(title), csvCell(keywords)];

    case 'istock':
      return [csvCell(filename), csvCell(title), csvCell(description), csvCell(keywords)];

    case 'dreamstime':
      // Dreamstime: Filename, Image Name (title), Description, Keywords, Category
      return [csvCell(filename), csvCell(title), csvCell(description), csvCell(keywords), csvCell(category)];

    case 'depositphotos':
      return [csvCell(filename), csvCell(title), csvCell(description), csvCell(keywords), csvCell(category)];

    case 'rf123':
      return [csvCell(filename), csvCell(title), csvCell(description), csvCell(keywords)];

    case 'custom':
    default:
      return [csvCell(filename), csvCell(title), csvCell(description), csvCell(keywords), csvCell(category)];
  }
}

// ── Validate a single row ───────────────────────────────────────────────────
export function validateItem(item, platform) {
  const issues = [];
  const meta = item.metadata || {};

  if (!item.name) issues.push('Missing filename');
  if (!meta.title || meta.title.trim().length === 0) issues.push('Missing title');
  if (platform.id !== 'freepik' && (!meta.description || meta.description.trim().length === 0)) {
    // description not required for freepik
    if (['shutterstock','istock','dreamstime','depositphotos','rf123','custom'].includes(platform.id)) {
      issues.push('Missing description');
    }
  }
  if (!meta.keywords || meta.keywords.length === 0) issues.push('Missing keywords');
  if (meta.keywords && meta.keywords.length > platform.keywordMax) {
    issues.push(`Too many keywords (${meta.keywords.length} > max ${platform.keywordMax})`);
  }
  if (meta.keywords && meta.keywords.length < platform.keywordMin) {
    issues.push(`Too few keywords (${meta.keywords.length} < min ${platform.keywordMin})`);
  }
  if (platform.categories.length > 0 && (!meta.category || meta.category.trim().length === 0)) {
    issues.push('Missing category');
  }

  // Check for duplicate keywords
  if (meta.keywords && meta.keywords.length > 0) {
    const lower = meta.keywords.map(k => k.toLowerCase());
    const unique = new Set(lower);
    if (unique.size < lower.length) issues.push('Duplicate keywords detected');
  }

  return issues;
}

// ── Validate entire batch ───────────────────────────────────────────────────
export function validateBatch(items, platform) {
  const results = [];
  items.forEach(item => {
    const issues = validateItem(item, platform);
    if (issues.length > 0) results.push({ item, issues });
  });
  return results; // empty array = all valid
}

// ── Generate CSV text ───────────────────────────────────────────────────────
export function generateCsvContent(mediaItems, platform) {
  const headers = platform.csvColumns.map(h => csvCell(h)).join(',');
  const rows = mediaItems.map(item => formatRowForPlatform(item, platform).join(','));
  return '\uFEFF' + [headers, ...rows].join('\r\n'); // BOM + CRLF
}

// ── Download CSV ────────────────────────────────────────────────────────────
export function downloadCsvFile(mediaItems, platform) {
  const csvContent = generateCsvContent(mediaItems, platform);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const timestamp = new Date().toISOString().slice(0, 10);
  const platformSlug = platform.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const filename = `microstock-metadata-${platformSlug}-${timestamp}.csv`;

  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Generate HTML preview table ─────────────────────────────────────────────
export function generateCsvPreviewHtml(mediaItems, platform, maxRows = 8) {
  const headers = platform.csvColumns;
  const previewItems = mediaItems.slice(0, maxRows);

  const headerHtml = headers.map(h => `<th>${escHtml(h)}</th>`).join('');
  const rowsHtml = previewItems.map(item => {
    const meta = item.metadata || {};
    const kwCount = (meta.keywords || []).length;
    const row = formatRowForPlatform(item, platform);
    // Replace keyword cell with count display
    const cells = row.map((cell, i) => {
      const raw = cell.replace(/^"|"$/g, '').replace(/""/g, '"');
      if (headers[i] === 'Keywords') {
        return `<td><span style="font-size:0.75rem;color:var(--text-muted)">${escHtml(raw.substring(0, 60))}…</span><br><strong style="color:var(--accent-cyan)">${kwCount}/${platform.keywordMax} kw</strong></td>`;
      }
      const truncated = raw.length > 60 ? raw.substring(0, 60) + '…' : raw;
      return `<td title="${escHtml(raw)}">${escHtml(truncated)}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  return `<table class="csv-preview-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
