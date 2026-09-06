import assert from "node:assert/strict";
import test from "node:test";
import {
  safeAiAttachmentName,
  validateAiAttachment,
  validateAiAttachmentBatch,
} from "./attachments";

test("accepts supported raster image signatures", () => {
  const png = validateAiAttachment("screen.png", Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]));
  assert.equal(png.kind, "image");
  assert.equal(png.mediaType, "image/png");
});

test("accepts valid UTF-8 text and rejects unsupported binary files", () => {
  const markdown = validateAiAttachment("notes.md", new TextEncoder().encode("# Notes"));
  assert.equal(markdown.kind, "text");
  assert.throws(
    () => validateAiAttachment("archive.zip", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
    (error: Error & { status?: number }) => error.status === 415,
  );
  assert.throws(
    () => validateAiAttachment("broken.txt", Uint8Array.from([0xc3, 0x28])),
    (error: Error & { status?: number }) => error.status === 415,
  );
});

test("normalizes unsafe attachment names", () => {
  assert.equal(safeAiAttachmentName("../../my<script>.tsx"), "my-script-.tsx");
  assert.equal(safeAiAttachmentName(".."), "attachment");
});

test("enforces message and conversation limits", () => {
  assert.throws(
    () => validateAiAttachmentBatch(Array.from({ length: 5 }, () => ({ sizeBytes: 1 }))),
    (error: Error & { status?: number }) => error.status === 400,
  );
  assert.throws(
    () => validateAiAttachmentBatch([{ sizeBytes: 4 * 1024 * 1024 + 1 }]),
    (error: Error & { status?: number }) => error.status === 413,
  );
  assert.throws(
    () => validateAiAttachmentBatch([{ sizeBytes: 1 }], 40 * 1024 * 1024, 1),
    (error: Error & { status?: number }) => error.status === 413,
  );
});
