import { describe, expect, it } from 'vitest';
import {
  documentExt,
  isAllowedDocumentMime,
  readImageSize,
  sniffDocumentMime,
  sniffProductImageMime,
} from './storage';

/** Build a buffer that starts with `head` bytes, padded to at least `len`. */
const bytes = (head: number[], len = 16): Uint8Array => {
  const out = new Uint8Array(Math.max(len, head.length));
  out.set(head);
  return out;
};

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
/** [4-byte size]["ftyp"][brand] */
const heic = (brand: string): Uint8Array =>
  bytes([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0))]);

describe('sniffDocumentMime', () => {
  it('detects each format on the document allow-list', () => {
    expect(sniffDocumentMime(PDF)).toBe('application/pdf');
    expect(sniffDocumentMime(JPEG)).toBe('image/jpeg');
    expect(sniffDocumentMime(PNG)).toBe('image/png');
    expect(sniffDocumentMime(WEBP)).toBe('image/webp');
    expect(sniffDocumentMime(heic('heic'))).toBe('image/heic');
  });

  it('accepts the HEIC/HEIF brands iPhones actually emit', () => {
    for (const brand of ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(sniffDocumentMime(heic(brand)), brand).toBe('image/heic');
    }
  });

  it('always returns a MIME that is on the allow-list', () => {
    for (const b of [PDF, JPEG, PNG, WEBP, heic('heic')]) {
      const mime = sniffDocumentMime(b);
      expect(mime).not.toBeNull();
      expect(isAllowedDocumentMime(mime!)).toBe(true);
    }
  });

  it('rejects bytes that are not an allowed document', () => {
    expect(sniffDocumentMime(bytes([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    // An ISO-BMFF container that is not a HEIC still image (e.g. an MP4).
    expect(sniffDocumentMime(heic('isom'))).toBeNull();
    // A script that merely *claims* to be a PDF by extension has no %PDF header.
    expect(sniffDocumentMime(new TextEncoder().encode('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(sniffDocumentMime(bytes([], 0))).toBeNull();
  });

  it('does not read past a short buffer', () => {
    expect(sniffDocumentMime(bytes([0x25, 0x50], 2))).toBeNull();
    expect(sniffDocumentMime(bytes([0xff, 0xd8], 2))).toBeNull();
  });
});

describe('documentExt', () => {
  it('maps each allowed MIME to its extension', () => {
    expect(documentExt('application/pdf')).toBe('pdf');
    expect(documentExt('image/jpeg')).toBe('jpg');
    expect(documentExt('image/png')).toBe('png');
    expect(documentExt('image/webp')).toBe('webp');
    expect(documentExt('image/heic')).toBe('heic');
  });
});

describe('sniffProductImageMime', () => {
  it('stays narrower than the document sniffer — no PDF or HEIC', () => {
    expect(sniffProductImageMime(PDF)).toBeNull();
    expect(sniffProductImageMime(heic('heic'))).toBeNull();
    expect(sniffProductImageMime(JPEG)).toBe('image/jpeg');
  });
});

describe('readImageSize', () => {
  /** PNG: 8-byte signature, IHDR length+type, then width/height as uint32 BE. */
  const png = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(32);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };

  /** JPEG: SOI, one APP0 segment to skip over, then an SOF0 carrying the size. */
  const jpeg = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(40);
    const v = new DataView(b.buffer);
    b.set([0xff, 0xd8, 0xff, 0xe0]); // SOI + APP0
    v.setUint16(4, 8); // APP0 length (4 payload bytes)
    b.set([0xff, 0xc0], 12); // SOF0
    v.setUint16(14, 17); // segment length
    b[16] = 8; // sample precision
    v.setUint16(17, h);
    v.setUint16(19, w);
    return b;
  };

  /** WebP (lossy VP8): RIFF/WEBP header, chunk tag, sync code, 14-bit dims. */
  const webp = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(40);
    b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
    b.set([0x9d, 0x01, 0x2a], 23); // sync code
    new DataView(b.buffer).setUint16(26, w, true);
    new DataView(b.buffer).setUint16(28, h, true);
    return b;
  };

  it('reads PNG dimensions', () => {
    expect(readImageSize(png(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('reads JPEG dimensions past a leading APP0 segment', () => {
    expect(readImageSize(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it('reads lossy WebP dimensions', () => {
    expect(readImageSize(webp(512, 512))).toEqual({ width: 512, height: 512 });
  });

  it('returns null for a non-image and for a truncated header', () => {
    expect(readImageSize(PDF)).toBeNull();
    expect(readImageSize(png(800, 600).subarray(0, 12))).toBeNull();
    // A JPEG whose SOF marker never arrives must not loop or guess.
    expect(readImageSize(JPEG)).toBeNull();
  });
});
