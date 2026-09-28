// Escape raw HTML; only emit the formatting tags supported by rich-text.
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(text: string): string {
  const codes: string[] = [];
  let value = escape(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code style="background:rgba(128,128,128,.12);padding:2px 4px;border-radius:4px">${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  value = value.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>')
    .replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, '<em>$1$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  return value.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}
export function markdown(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) code.push(lines[i++]);
      if (i < lines.length) i++;
      out.push(`<pre style="background:rgba(128,128,128,.12);padding:12px;border-radius:8px;white-space:pre;margin:8px 0"><code>${escape(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { out.push(`<h${heading[1].length} style="font-size:${22 - heading[1].length}px;font-weight:600;margin:10px 0 6px">${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
    if (i + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])) {
      const row = (s: string, tag: string) => '<tr>' + cells(s).map(c => `<${tag} style="border:1px solid #a0aaa5;padding:6px 10px;white-space:normal;min-width:70px">${inline(c)}</${tag}>`).join('') + '</tr>';
      let table = '<table style="border-collapse:collapse;margin:8px 0">' + row(line, 'th'); i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) table += row(lines[i++], 'td');
      out.push(table + '</table>'); continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*> ?/, ''));
      out.push(`<blockquote style="border-left:3px solid #81998e;padding-left:10px;margin:8px 0;color:inherit">${markdown(quote.join('\n'))}</blockquote>`); continue;
    }
    const list = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      const tag = list[2] ? 'ol' : 'ul'; let items = '';
      while (i < lines.length) {
        const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);
        if (!item || !!item[2] !== !!list[2]) break;
        items += `<li style="margin:4px 0">${inline(item[3])}</li>`; i++;
      }
      out.push(`<${tag} style="padding-left:24px;margin:8px 0"${list[2] ? ` start="${list[2]}"` : ''}>${items}</${tag}>`); continue;
    }
    out.push(`<p style="margin:6px 0">${inline(line)}</p>`); i++;
  }
  return out.join('');
}
