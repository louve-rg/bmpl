import { describe, expect, it } from 'vitest';
import { isAllowedResumeMime, resumeExt, sniffResumeMime } from './jobs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const bytes = (...parts: Array<number[] | string>): Uint8Array => {
  const flat: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') flat.push(...[...p].map((c) => c.charCodeAt(0)));
    else flat.push(...p);
  }
  return new Uint8Array(flat);
};

const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** Filler for the fixed-width fields between the ZIP signature and the entry name. */
const ZIP_ENTRY_HEADER = [0x14, 0x00, 0x00, 0x00];
const PDF = bytes([0x25, 0x50, 0x44, 0x46], '-1.7\n%????');
/** A ZIP whose entry table names a `word/` part — i.e. a WordprocessingML package. */
const docx = bytes(ZIP, ZIP_ENTRY_HEADER, '[Content_Types].xml', 'word/document.xml');

describe('sniffResumeMime', () => {
  it('detects a PDF from its signature', () => {
    expect(sniffResumeMime(PDF)).toBe('application/pdf');
  });

  it('detects a DOCX by its ZIP container plus a word/ part', () => {
    expect(sniffResumeMime(docx)).toBe(DOCX);
  });

  it('rejects other OOXML packages that share the ZIP signature', () => {
    // .xlsx and .pptx are ZIPs too — the word/ part is what distinguishes a DOCX.
    expect(sniffResumeMime(bytes(ZIP, '[Content_Types].xml', 'xl/workbook.xml'))).toBeNull();
    expect(sniffResumeMime(bytes(ZIP, '[Content_Types].xml', 'ppt/presentation.xml'))).toBeNull();
  });

  it('rejects a plain ZIP and a renamed archive', () => {
    expect(sniffResumeMime(bytes(ZIP, 'notes.txt'))).toBeNull();
    expect(sniffResumeMime(bytes(ZIP))).toBeNull();
  });

  it('rejects images and scripts, which are NOT valid résumés', () => {
    expect(sniffResumeMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // JPEG
    expect(sniffResumeMime(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(sniffResumeMime(bytes('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(sniffResumeMime(new Uint8Array())).toBeNull();
  });

  it('does not read past a short buffer', () => {
    expect(sniffResumeMime(bytes([0x25, 0x50]))).toBeNull();
    expect(sniffResumeMime(bytes([0x50, 0x4b]))).toBeNull();
  });

  it('only ever returns a MIME on the résumé allow-list', () => {
    for (const b of [PDF, docx]) {
      const mime = sniffResumeMime(b);
      expect(mime).not.toBeNull();
      expect(isAllowedResumeMime(mime!)).toBe(true);
    }
  });
});

describe('resumeExt', () => {
  it('maps each résumé MIME to its extension', () => {
    expect(resumeExt('application/pdf')).toBe('pdf');
    expect(resumeExt(DOCX)).toBe('docx');
  });
});
