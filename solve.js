// A fast single-pass reader for the csv-reader 1.0.0 dialect.
//
// The text is scanned once, left to right. A record that sits on one
// physical line and holds no quote and no stray CR is split on its commas
// directly; every other record goes through the field scanner, which jumps
// between delimiters with indexOf so plain fields cost a couple of native
// searches and one slice. The reading rules implemented here:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line with no characters is no record;
//   - a CR outside quotes that is not part of a CRLF is dropped (stray_cr);
//   - a field opening with a double quote runs to the next quote that is not
//     doubled; inside it "" is one quote and every CRLF or lone CR reads as
//     LF; whatever stands between the closing quote and the next comma or
//     line break is appended verbatim (quote_junk, reported as the field
//     ends); a quote that never closes is a literal character and the rest
//     of the field is read again as unquoted text (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields are never trimmed or converted;
//   - the first record fixes the width: it becomes `columns` when the case
//     asks for a header, otherwise it is the first row; every later record
//     is padded with empty strings (short_row) or cut (long_row) to it.
// Errors are {code, line, row} in the order met; line is the 1-based line
// the record starts on (counting every LF, CRLF and lone CR inside quotes)
// and row is the record's index in rows, null for the header record.

export function run(input) {
  const text = input.text;
  const header = !!input.header;
  const n = text.length;

  let pos = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let line = 1;
  let seen = 0; // records finished so far, header included

  // Coordinates of the record being read; every error met while reading it
  // is reported against these.
  let recLine = 1;
  let recRow = null;

  function report(code, extra) {
    const err = { code, line: recLine, row: recRow };
    if (extra !== undefined) Object.assign(err, extra);
    errors.push(err);
  }

  // Reads one unquoted field starting at pos. `prefix` is text that already
  // belongs to the field (the literal quote of an unterminated field).
  // Returns {value, term} with term 'comma', 'eol' or 'eof'.
  function readUnquoted(prefix) {
    let parts = null;
    let seg = pos;
    const done = (end, term, next) => {
      let value = text.slice(seg, end);
      if (parts !== null) {
        parts.push(value);
        value = parts.join('');
      }
      pos = next;
      return { value: prefix + value, term };
    };
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = text.indexOf('\r', pos);
      let at = -1;
      let kind = 0; // 1 comma, 2 LF, 3 CR
      if (comma !== -1) { at = comma; kind = 1; }
      if (lf !== -1 && (at === -1 || lf < at)) { at = lf; kind = 2; }
      if (cr !== -1 && (at === -1 || cr < at)) { at = cr; kind = 3; }
      if (kind === 0) return done(n, 'eof', n);
      if (kind === 1) return done(at, 'comma', at + 1);
      if (kind === 2) return done(at, 'eol', at + 1);
      if (text.charCodeAt(at + 1) === 10) return done(at, 'eol', at + 2);
      // A lone CR outside quotes: dropped, the field goes on without it.
      if (parts === null) parts = [];
      parts.push(text.slice(seg, at));
      report('stray_cr');
      pos = at + 1;
      seg = pos;
    }
  }

  // Builds the value of a quoted field's content text[from, to): unescapes
  // doubled quotes and reads CRLF / lone CR as LF, and advances the line
  // counter past every line break the content holds.
  function quotedValue(from, to) {
    let breaks = 0;
    for (let k = from; k < to;) {
      const lf = text.indexOf('\n', k);
      if (lf === -1 || lf >= to) break;
      breaks++;
      k = lf + 1;
    }
    for (let k = from; k < to;) {
      const cr = text.indexOf('\r', k);
      if (cr === -1 || cr >= to) break;
      if (text.charCodeAt(cr + 1) !== 10) breaks++;
      k = cr + 1;
    }
    line += breaks;

    const quoteAt = text.indexOf('"', from);
    const crAt = text.indexOf('\r', from);
    if ((quoteAt === -1 || quoteAt >= to) && (crAt === -1 || crAt >= to)) {
      return text.slice(from, to); // nothing to rewrite
    }
    const parts = [];
    let seg = from;
    let k = from;
    while (k < to) {
      const q = text.indexOf('"', k);
      const r = text.indexOf('\r', k);
      let at = -1;
      let isQuote = false;
      if (q !== -1 && q < to) { at = q; isQuote = true; }
      if (r !== -1 && r < to && (at === -1 || r < at)) { at = r; isQuote = false; }
      if (at === -1) break;
      parts.push(text.slice(seg, at));
      if (isQuote) {
        parts.push('"');
        k = at + 2; // a doubled quote inside the content
      } else {
        parts.push('\n');
        k = text.charCodeAt(at + 1) === 10 ? at + 2 : at + 1;
      }
      seg = k;
    }
    parts.push(text.slice(seg, to));
    return parts.join('');
  }

  // Reads one field that opens with a double quote at pos.
  function readQuoted() {
    const contentFrom = pos + 1;
    // The closing quote is the first quote that is not doubled.
    let close = -1;
    for (let j = contentFrom;;) {
      const q = text.indexOf('"', j);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) { j = q + 2; continue; }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character and the text
      // after it is read again as an unquoted field.
      report('unterminated_quote');
      pos = contentFrom;
      return readUnquoted('"');
    }
    let value = quotedValue(contentFrom, close);
    pos = close + 1;
    // Junk between the closing quote and the next comma or line break is
    // appended as it stands; a lone CR in it is part of the junk.
    const junkFrom = pos;
    let term = 'eof';
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = text.indexOf('\r', pos);
      let at = -1;
      let kind = 0;
      if (comma !== -1) { at = comma; kind = 1; }
      if (lf !== -1 && (at === -1 || lf < at)) { at = lf; kind = 2; }
      if (cr !== -1 && (at === -1 || cr < at)) { at = cr; kind = 3; }
      if (kind === 0) { pos = n; term = 'eof'; break; }
      if (kind === 1) { pos = at; term = 'comma'; break; }
      if (kind === 2) { pos = at; term = 'eol'; break; }
      if (text.charCodeAt(at + 1) === 10) { pos = at; term = 'eol'; break; }
      pos = at + 1; // lone CR inside the junk: skip over it, keep scanning
    }
    if (pos > junkFrom) {
      value += text.slice(junkFrom, pos);
      report('quote_junk');
    }
    if (term === 'comma') pos += 1;
    else if (term === 'eol') pos += text.charCodeAt(pos) === 13 ? 2 : 1;
    return { value, term };
  }

  // Stores a finished record: the first one fixes the width (and becomes
  // the columns when a header was asked for); later ones are padded or cut
  // to that width, with the short_row / long_row error met as they end.
  function finishRecord(fields) {
    if (seen === 0) {
      width = fields.length;
      seen = 1;
      if (header) {
        columns = fields;
        return;
      }
      rows.push(fields);
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: rows.length, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: rows.length, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
    seen++;
  }

  while (pos < n) {
    recLine = line;
    recRow = header ? (seen === 0 ? null : seen - 1) : seen;

    // Fast path: when the rest of this physical line holds no quote and no
    // CR short of the CRLF that may end it, the record is the line split on
    // its commas — no field scanner, no errors, nothing to rewrite.
    const lfAt = text.indexOf('\n', pos);
    const lineEnd = lfAt === -1 ? n : lfAt;
    let contentEnd = lineEnd;
    if (lfAt !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) {
      contentEnd--;
    }
    const quoteAt = text.indexOf('"', pos);
    const crAt = text.indexOf('\r', pos);
    if ((quoteAt === -1 || quoteAt >= contentEnd) && (crAt === -1 || crAt >= contentEnd)) {
      const recFrom = pos;
      pos = lfAt === -1 ? n : lfAt + 1;
      if (lfAt !== -1) line++;
      if (contentEnd > recFrom) {
        finishRecord(text.slice(recFrom, contentEnd).split(','));
      }
      continue;
    }

    const fields = [];
    let hasContent = false;
    let term = 'comma';
    while (term === 'comma') {
      let field;
      if (text.charCodeAt(pos) === 34) {
        field = readQuoted();
        hasContent = true;
      } else {
        field = readUnquoted('');
        if (field.value.length > 0) hasContent = true;
      }
      fields.push(field.value);
      if (fields.length > 1) hasContent = true;
      term = field.term;
    }
    if (term === 'eol') line++;
    // A line left with no characters is no record.
    if (!hasContent && fields.length === 1) continue;
    finishRecord(fields);
  }

  return { columns, rows, errors };
}
