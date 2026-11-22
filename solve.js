// solve.js — a fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) reads input {text, header} and returns {columns, rows, errors},
// exactly the answer csv-reader 1.0.0 gives for the same input:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is
//     no record at all;
//   - outside quotes, a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote; each CRLF or lone CR inside it
//     is read as LF); whatever follows the closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, reported
//     when the field ends);
//   - a quote that never closes is a literal character, and the text after
//     it is read again as unquoted text (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     holds the records after it (every record when header is false), each
//     padded with empty strings (short_row, with fields: its field count)
//     or cut (long_row, with extra: the cut fields) to the first record's
//     width;
//   - each error is {code, line, row} in the order met, a record's
//     short_row or long_row when it ends; line is the 1-based line the
//     record starts on, counting every LF, CRLF and lone CR inside quotes;
//     row is the record's index in rows, null for the header.
//
// The scan is a single left-to-right pass driven by indexOf, so the common
// unquoted path does no per-character work and builds no char arrays.

const QUOTE = 34;
const LF = 10;
const CR = 13;
const BOM = 0xfeff;

export function run(input) {
  const text = input.text;
  const wantHeader = !!input.header;
  const n = text.length;

  let pos = 0;
  if (n !== 0 && text.charCodeAt(0) === BOM) pos = 1;

  let line = 1; // physical line the scan is currently on, 1-based
  const errors = [];
  const records = [];
  let width = -1; // field count of the first record, once it is known

  // Context of the record being read, used by every error it produces.
  let recLine = 1;
  let recRow = null;

  // Outcome of the field parse most recently finished.
  let fValue = '';
  let fTerm = 2; // 0 = comma, 1 = line break, 2 = end of text
  let fChars = false; // the field consumed at least one counted character

  // The quoted segment text[from..to) with each CRLF or lone CR read as LF;
  // advances `line` past every line break inside it.
  function quotedSegment(from, to) {
    const crAt = text.indexOf('\r', from);
    if (crAt === -1 || crAt >= to) {
      // No CR inside: LFs stay LFs; only the line count needs updating,
      // and the segment is sliced out of the text just once.
      let idx = text.indexOf('\n', from);
      while (idx !== -1 && idx < to) {
        line++;
        idx = text.indexOf('\n', idx + 1);
      }
      return text.slice(from, to);
    }
    // Rare path: rebuild the segment, normalising CR and CRLF to LF.
    let out = '';
    let segStart = from;
    let k = from;
    while (k < to) {
      const ch = text.charCodeAt(k);
      if (ch === CR || ch === LF) {
        out += text.slice(segStart, k);
        out += '\n';
        line++;
        if (ch === CR && k + 1 < to && text.charCodeAt(k + 1) === LF) k++;
        k++;
        segStart = k;
      } else {
        k++;
      }
    }
    out += text.slice(segStart, to);
    return out;
  }

  // Read an unquoted field starting at pos, with `prefix` already in hand
  // (the literal opening quote of an unterminated field, else '').
  function scanUnquoted(prefix) {
    let value = prefix;
    if (prefix !== '') fChars = true;
    let seg = pos;
    for (;;) {
      const pComma = text.indexOf(',', seg);
      const pLf = text.indexOf('\n', seg);
      const pCr = text.indexOf('\r', seg);
      let p = -1;
      let kind = 0; // 1 comma, 2 LF, 3 CR
      if (pComma !== -1) { p = pComma; kind = 1; }
      if (pLf !== -1 && (p === -1 || pLf < p)) { p = pLf; kind = 2; }
      if (pCr !== -1 && (p === -1 || pCr < p)) { p = pCr; kind = 3; }
      if (p === -1) {
        value += text.slice(seg, n);
        if (n > seg) fChars = true;
        pos = n;
        fTerm = 2;
        break;
      }
      if (kind === 1) {
        value += text.slice(seg, p);
        if (p > seg) fChars = true;
        pos = p + 1;
        fTerm = 0;
        break;
      }
      if (kind === 2) {
        value += text.slice(seg, p);
        if (p > seg) fChars = true;
        pos = p + 1;
        line++;
        fTerm = 1;
        break;
      }
      // A CR: half of a CRLF record end, or a stray CR to drop.
      if (text.charCodeAt(p + 1) === LF) {
        value += text.slice(seg, p);
        if (p > seg) fChars = true;
        pos = p + 2;
        line++;
        fTerm = 1;
        break;
      }
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      value += text.slice(seg, p);
      pos = p + 1;
      seg = pos;
    }
    fValue = value;
  }

  // Read the junk after a closing quote: everything up to the next comma
  // or line break (LF or CRLF), appended to fValue as it stands. A lone CR
  // here is junk like any other character.
  function scanJunk() {
    const start = pos;
    let cur = pos;
    for (;;) {
      const pComma = text.indexOf(',', cur);
      const pLf = text.indexOf('\n', cur);
      const pCr = text.indexOf('\r', cur);
      let p = -1;
      let kind = 0;
      if (pComma !== -1) { p = pComma; kind = 1; }
      if (pLf !== -1 && (p === -1 || pLf < p)) { p = pLf; kind = 2; }
      if (pCr !== -1 && (p === -1 || pCr < p)) { p = pCr; kind = 3; }
      if (p === -1) {
        if (n > start) {
          fValue += text.slice(start, n);
          errors.push({ code: 'quote_junk', line: recLine, row: recRow });
        }
        pos = n;
        fTerm = 2;
        return;
      }
      if (kind === 1) {
        if (p > start) {
          fValue += text.slice(start, p);
          errors.push({ code: 'quote_junk', line: recLine, row: recRow });
        }
        pos = p + 1;
        fTerm = 0;
        return;
      }
      if (kind === 2) {
        if (p > start) {
          fValue += text.slice(start, p);
          errors.push({ code: 'quote_junk', line: recLine, row: recRow });
        }
        pos = p + 1;
        line++;
        fTerm = 1;
        return;
      }
      if (text.charCodeAt(p + 1) === LF) {
        if (p > start) {
          fValue += text.slice(start, p);
          errors.push({ code: 'quote_junk', line: recLine, row: recRow });
        }
        pos = p + 2;
        line++;
        fTerm = 1;
        return;
      }
      cur = p + 1; // a lone CR is part of the junk; keep scanning
    }
  }

  // Read a field that opens with a quote; pos is at the opening quote.
  function scanQuoted() {
    const saveLine = line;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. Undo the tentative scan.
        line = saveLine;
        errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
        pos += 1;
        scanUnquoted('"');
        return;
      }
      if (q > p) value += quotedSegment(p, q);
      if (text.charCodeAt(q + 1) === QUOTE) {
        value += '"';
        p = q + 2;
        continue;
      }
      // The closing quote.
      pos = q + 1;
      fValue = value;
      fChars = true;
      scanJunk();
      return;
    }
  }

  function parseField() {
    fValue = '';
    fTerm = 2;
    fChars = false;
    if (pos < n && text.charCodeAt(pos) === QUOTE) scanQuoted();
    else scanUnquoted('');
  }

  while (pos < n) {
    recLine = line;
    const recIndex = records.length;
    recRow = wantHeader ? (recIndex === 0 ? null : recIndex - 1) : recIndex;
    const fields = [];
    let recChars = false;
    for (;;) {
      parseField();
      fields.push(fValue);
      if (fChars) recChars = true;
      if (fTerm === 0) {
        recChars = true; // a comma is a character of the line
        continue;
      }
      break;
    }
    if (!recChars) continue; // a line left with no characters is no record
    if (width === -1) {
      width = fields.length;
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.splice(width);
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra });
    }
    records.push(fields);
  }

  let columns = null;
  let rows;
  if (wantHeader) {
    if (records.length !== 0) columns = records[0];
    rows = records.slice(1);
  } else {
    rows = records;
  }
  return { columns, rows, errors };
}
