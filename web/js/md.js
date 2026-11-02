// Tiny Markdown -> HTML renderer (headings, fenced code, tables, lists, quotes, inline code/bold/italic/links/images) for the write-up viewer.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => {
  const codes = []; s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = esc(s).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
};
export function md(src) {
  const L = src.replace(/\r/g, '').split('\n'); let o = [], i = 0, para = [];
  const flush = () => { if (para.length) { o.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { flush(); const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; o.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { flush(); const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); o.push(`<h${m[1].length} id="${id}">${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flush(); o.push('<hr>'); i++; continue; }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < L.length && /^\|[\s:|-]+\|\s*$/.test(L[i + 1])) {
      flush(); const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      let t = '<div class="tw"><table><thead><tr>' + row(l).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'; i += 2;
      while (i < L.length && /^\|.*\|\s*$/.test(L[i])) t += '<tr>' + row(L[i++]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
      o.push(t + '</tbody></table></div>'); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush(); const ord = /^\s*\d+\./.test(l); const items = [];
      while (i < L.length && (/^\s*([-*]|\d+\.)\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) { if (/^\s*([-*]|\d+\.)\s+/.test(L[i])) items.push(L[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); else items[items.length - 1] += ' ' + L[i].trim(); i++; }
      o.push((ord ? '<ol>' : '<ul>') + items.map(x => '<li>' + inline(x) + '</li>').join('') + (ord ? '</ol>' : '</ul>')); continue;
    }
    if (/^>\s?/.test(l)) { flush(); const b = []; while (i < L.length && /^>\s?/.test(L[i])) b.push(L[i++].replace(/^>\s?/, '')); o.push('<blockquote>' + inline(b.join(' ')) + '</blockquote>'); continue; }
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush(); return o.join('\n');
}
