const KNOWN_HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote',
  'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data',
  'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd',
  'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta', 'meter', 'nav',
  'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre',
  'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search', 'section', 'select',
  'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg', 'table',
  'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'u', 'ul', 'var', 'video', 'wbr'
]);

/**
 * Strips only real HTML tags from lesson text while preserving code syntax (e.g., "for (i = 0; i < n; i++)", "#include <stdio.h>"),
 * decodes basic entities, and neutralizes any literal <lesson_content> delimiters so malicious content cannot break out.
 */
export function stripHtml(input: string): string {
  if (!input) return '';

  // 1. Remove only real HTML tags (/<\/?[a-zA-Z][^>]*>/g)
  let cleaned = input.replace(/<\/?[a-zA-Z][^>]*>/g, (match) => {
    const tagMatch = match.match(/^<\/?([a-zA-Z0-9]+)/);
    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase();
      if (KNOWN_HTML_TAGS.has(tag)) {
        return ' ';
      }
    }
    return match; // preserve non-HTML code tags like <stdio.h>, <vector>, etc.
  });

  // 2. Decode basic HTML entities
  cleaned = cleaned
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');

  // 3. Separately neutralize any literal "<lesson_content" or "</lesson_content"
  // so it cannot break out of the delimiter block in the AI prompt
  cleaned = cleaned.replace(/<\/?lesson_content/gi, (m) =>
    m.startsWith('</') ? '&lt;/lesson_content' : '&lt;lesson_content'
  );

  return cleaned.replace(/\s+/g, ' ').trim();
}
