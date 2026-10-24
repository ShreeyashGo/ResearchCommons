"use client";

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
// pdfjs-dist does not re-export TextContent from its index; pull it from the api types.

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  // The worker is vendored into public/ (cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs).
  // A static URL works under every bundler; pdf.js falls back to a main-thread
  // "fake worker" if the file can't be served.
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export async function loadPdf(bytes: Uint8Array | ArrayBuffer): Promise<PDFDocumentProxy> {
  configure();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return getDocument({ data }).promise;
}

export async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export { TextLayer } from "pdfjs-dist";
export type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
export type { TextContent } from "pdfjs-dist/types/src/display/api";
