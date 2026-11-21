// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's answer for every input.
// Same policy as the reference (one pass, left to right), but fields are cut with slice() instead of being built
// one character at a time, and the scan runs over char codes instead of string indexing.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let ended = END; // how the last field read ended
  let added = 0; // characters the last unquoted read kept

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from `start` onto `prefix`, up to the next comma or line break. A CR not followed
  // by LF is dropped (stray_cr). Sets pos, line, ended and added.
  function readUnquoted(prefix, start) {
    let i = start;
    let segStart = start;
    let parts = null;
    let strays = 0;
    let code = END;
    let stop = n;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) { code = COMMA; stop = i; break; }
      if (c === 10) { code = LINE_BREAK; stop = i; break; }
      if (c === 13) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) { code = LINE_BREAK; stop = i; break; }
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i));
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        strays += 1;
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    added = (stop - start) - strays;
    if (code === COMMA) {
      pos = stop + 1;
    } else if (code === LINE_BREAK) {
      pos = text.charCodeAt(stop) === 13 ? stop + 2 : stop + 1;
      line += 1;
    } else {
      pos = n;
    }
    ended = code;
    const seg = text.slice(segStart, stop);
    if (parts === null) return prefix === '' ? seg : prefix + seg;
    parts.push(seg);
    const joined = parts.join('');
    return prefix === '' ? joined : prefix + joined;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = open + 1;
    let segStart = i;
    let parts = null;
    let closed = false;
    let closeAt = -1;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i), '"');
          i += 2;
          segStart = i;
          continue;
        }
        closed = true;
        closeAt = i;
        break;
      }
      if (c === 13) {
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += i + 1 < n && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        segStart = i;
        continue;
      }
      if (c === 10) {
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"', open + 1);
    }
    const tail = text.slice(segStart, closeAt);
    let value;
    if (parts === null) {
      value = tail;
    } else {
      parts.push(tail);
      value = parts.join('');
    }
    pos = closeAt + 1;
    if (pos >= n) { ended = END; return value; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; ended = COMMA; return value; }
    if (c === 10) { pos += 1; line += 1; ended = LINE_BREAK; return value; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value, pos);
    if (added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quotedLast = false;
    for (;;) {
      const quoted = text.charCodeAt(pos) === 34;
      quotedLast = quoted;
      fields.push(quoted ? readQuoted() : readUnquoted('', pos));
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
