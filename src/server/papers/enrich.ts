import "server-only";

import {
  fetchJsonWithBackoff,
  fetchOpenAlexByDoi,
  searchOpenAlex,
  type FetchLike,
} from "@/server/citations/resolve";
import { titleSimilarity, yearCompatible } from "@/server/citations/match";
import { getPaperPages } from "@/server/papers/text";
import { createAdminClient } from "@/server/supabase/admin";
import { parseServerEnv, serverEnvSchema } from "@/server/env";

type Admin = ReturnType<typeof createAdminClient>;

type MetadataCandidate = {
  abstract?: string | null;
  authors?: string[] | null;
  year?: number | null;
  doi?: string | null;
};

type CrossrefWork = {
  title?: unknown;
  author?: unknown;
  issued?: unknown;
  DOI?: unknown;
  abstract?: unknown;
};

function isEmptyAbstract(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function crossrefMetadata(work: CrossrefWork | null): MetadataCandidate {
  if (!work) return {};
  const authors = Array.isArray(work.author)
    ? work.author
        .map((author) => {
          const entry = asRecord(author);
          return [entry?.given, entry?.family]
            .filter((part): part is string => typeof part === "string")
            .join(" ")
            .trim();
        })
        .filter(Boolean)
    : [];
  const issued = asRecord(work.issued);
  const dateParts = issued?.["date-parts"];
  const yearValue =
    Array.isArray(dateParts) && Array.isArray(dateParts[0])
      ? dateParts[0][0]
      : null;
  const abstract =
    typeof work.abstract === "string"
      ? work.abstract
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .replace(/^\s*abstract\b[\s.:—-]*/i, "")
          .trim()
      : "";

  return {
    authors,
    year:
      typeof yearValue === "number" && Number.isInteger(yearValue)
        ? yearValue
        : null,
    doi: typeof work.DOI === "string" ? work.DOI : null,
    abstract: abstract || null,
  };
}

function crossrefWork(json: unknown, byDoi: boolean, title: string): CrossrefWork | null {
  const message = asRecord(asRecord(json)?.message);
  if (!message) return null;
  const candidate = byDoi
    ? message
    : Array.isArray(message.items)
      ? asRecord(message.items[0])
      : null;
  if (!candidate) return null;

  if (!byDoi) {
    const candidateTitle = Array.isArray(candidate.title)
      && typeof candidate.title[0] === "string"
      ? candidate.title[0]
      : null;
    if (!candidateTitle || titleSimilarity(title, candidateTitle) < 0.9) {
      return null;
    }
  }
  return candidate as CrossrefWork;
}

function firstPageAbstract(text: string): string | null {
  const match =
    /\babstract\b[\s.:—-]*([\s\S]+?)(?=\b(?:1\.?\s+)?introduction\b|\bkeywords?\b|$)/i.exec(
      text,
    );
  const abstract = match?.[1]?.trim();
  return abstract && abstract.length >= 100
    ? abstract.slice(0, 3000).trim()
    : null;
}

export async function enrichPaperMetadata(
  paperId: string,
  deps: { admin?: Admin; fetchImpl?: FetchLike; mailto?: string } = {},
): Promise<{ updated: string[] }> {
  const admin = deps.admin ?? createAdminClient();
  const { data: paper, error } = await admin
    .from("papers")
    .select("id, source, title, authors, year, abstract, doi")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw error;
  if (!paper || paper.source !== "upload") return { updated: [] };

  const missing = {
    abstract: isEmptyAbstract(paper.abstract),
    authors: paper.authors.length === 0,
    year: paper.year === null,
    doi: paper.doi === null,
  };
  if (!missing.abstract && !missing.authors) return { updated: [] };

  const updates: {
    abstract?: string;
    authors?: string[];
    year?: number;
    doi?: string;
  } = {};
  const merge = (candidate: MetadataCandidate | null) => {
    if (!candidate) return;
    if (missing.abstract && candidate.abstract?.trim()) {
      updates.abstract = candidate.abstract.trim();
      missing.abstract = false;
    }
    const authors = candidate.authors?.filter((author) => author.trim()) ?? [];
    if (missing.authors && authors.length > 0) {
      updates.authors = authors;
      missing.authors = false;
    }
    if (missing.year && typeof candidate.year === "number") {
      updates.year = candidate.year;
      missing.year = false;
    }
    if (missing.doi && candidate.doi?.trim()) {
      updates.doi = candidate.doi.trim();
      missing.doi = false;
    }
  };
  const hasMissingFields = () => Object.values(missing).some(Boolean);

  const env = serverEnvSchema.safeParse(process.env).success
    ? parseServerEnv()
    : null;
  const mailto = deps.mailto ?? env?.CONTACT_EMAIL;
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (paper.doi) {
    try {
      merge(await fetchOpenAlexByDoi(paper.doi, { mailto, fetchImpl }));
    } catch (error) {
      console.warn(`[enrich] OpenAlex DOI lookup failed for ${paperId}:`, error);
    }
  }

  if (hasMissingFields()) {
    try {
      const candidates = await searchOpenAlex(paper.title, {
        mailto,
        fetchImpl,
      });
      const best = candidates
        .map((candidate) => ({
          work: candidate.work,
          similarity: titleSimilarity(paper.title, candidate.work.title),
        }))
        .sort((a, b) => b.similarity - a.similarity)[0];
      if (
        best &&
        best.similarity >= 0.9 &&
        yearCompatible(paper.year, best.work.year)
      ) {
        merge(best.work);
      }
    } catch (error) {
      console.warn(`[enrich] OpenAlex title search failed for ${paperId}:`, error);
    }
  }

  if (hasMissingFields()) {
    const doi = updates.doi ?? paper.doi;
    const url = new URL(
      doi
        ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
        : "https://api.crossref.org/works",
    );
    if (!doi) {
      url.searchParams.set("query.bibliographic", paper.title);
      url.searchParams.set("rows", "1");
    }
    if (mailto) url.searchParams.set("mailto", mailto);

    try {
      const json = await fetchJsonWithBackoff(
        url.toString(),
        { headers: { accept: "application/json" } },
        fetchImpl,
      );
      merge(
        crossrefMetadata(
          crossrefWork(json, Boolean(doi), paper.title),
        ),
      );
    } catch (error) {
      console.warn(`[enrich] Crossref lookup failed for ${paperId}:`, error);
    }
  }

  if (missing.abstract) {
    try {
      const pages = await getPaperPages(paperId, admin);
      const firstPage = pages?.find((page) => page.pageIndex === 0)?.text ?? "";
      let abstract = firstPageAbstract(firstPage);
      if (!abstract) {
        const secondPage = pages?.find((page) => page.pageIndex === 1)?.text;
        if (secondPage) {
          abstract = firstPageAbstract(`${firstPage} ${secondPage}`);
        }
      }
      if (abstract) {
        updates.abstract = abstract;
        missing.abstract = false;
      }
    } catch (error) {
      console.warn(`[enrich] page-text abstract fallback failed for ${paperId}:`, error);
    }
  }

  const updated = ["abstract", "authors", "year", "doi"].filter((field) =>
    Object.prototype.hasOwnProperty.call(updates, field),
  );
  if (updated.length === 0) return { updated };

  const { error: updateError } = await admin
    .from("papers")
    .update(updates)
    .eq("id", paperId);
  if (updateError) throw updateError;
  return { updated };
}
