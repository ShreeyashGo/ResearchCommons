import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  AnnotationAnchor,
  type Annotation,
  type AnnotationAnchor as AnnotationAnchorType,
} from "@/contracts/annotations";
import { createAdminClient } from "@/server/supabase/admin";
import {
  addComment,
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
} from "@/server/annotations/service";
import { extractPdf } from "@/server/citations/extract";
import { startPaperProcessing } from "@/server/citations/pipeline";
import { createGroup, joinGroup, listGroups } from "@/server/groups/service";
import { uploadPaper } from "@/server/papers/service";
import { listReviews, upsertMyReview } from "@/server/reviews/service";

const ARXIV_ID = "1706.03762";
const GROUP_NAME = "Koala Lab";
const DEMO_PASSWORD = "koala-demo-123";
const PAPER_TITLE = "Attention Is All You Need";
const PAPER_ABSTRACT = [
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
  "The best performing models also connect the encoder and decoder through an attention mechanism.",
  "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
  "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.",
  "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU.",
  "On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature.",
  "We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.",
].join(" ");
const ALICE = { email: "alice@koalalab.dev", name: "Alice Koala" };
const BOB = { email: "bob@koalalab.dev", name: "Bob Koala" };

const unusedWebSocketTransport = class {
  constructor() {
    throw new Error("Realtime is not used by the demo seed.");
  }
};

type DemoIdentity = { client: SupabaseClient; user: User };

function loadLocalSupabaseEnvironment(): {
  url: string;
  anonKey: string;
} {
  const envFile = path.join(process.cwd(), ".env.local");
  if (!existsSync(envFile)) {
    throw new Error("Missing .env.local. Run pnpm env:local first.");
  }
  loadEnvFile(envFile);

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is missing from .env.local.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  if (
    parsedUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsedUrl.hostname)
  ) {
    throw new Error(
      `Refusing to seed non-local Supabase URL: ${parsedUrl.origin}`,
    );
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase keys are missing. Run pnpm env:local first.");
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  return { url, anonKey };
}

async function findAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(`Could not list demo users: ${error.message}`);
    }
    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) {
      return user;
    }
    if (data.users.length < 1000) {
      return null;
    }
  }
}

async function ensureAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  identity: typeof ALICE,
): Promise<User> {
  const existing = await findAuthUser(admin, identity.email);
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password: DEMO_PASSWORD,
      user_metadata: {
        ...existing.user_metadata,
        display_name: identity.name,
      },
    });
    if (error || !data.user) {
      throw new Error(
        `Could not update ${identity.email}: ${error?.message ?? "no user returned"}`,
      );
    }
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: identity.name },
  });
  if (error || !data.user) {
    throw new Error(
      `Could not create ${identity.email}: ${error?.message ?? "no user returned"}`,
    );
  }
  return data.user;
}

async function signIn(
  url: string,
  anonKey: string,
  identity: typeof ALICE,
): Promise<DemoIdentity> {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: unusedWebSocketTransport as never },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: identity.email,
    password: DEMO_PASSWORD,
  });
  if (error || !data.user) {
    throw new Error(
      `Could not sign in ${identity.email}: ${error?.message ?? "no user returned"}`,
    );
  }
  return { client, user: data.user };
}

async function ensureGroup(alice: DemoIdentity) {
  const matches = (await listGroups(alice.client, alice.user.id)).filter(
    (group) => group.name === GROUP_NAME,
  );
  if (matches.length > 1) {
    throw new Error(`More than one ${GROUP_NAME} group is owned by Alice.`);
  }
  if (matches[0]) {
    if (matches[0].myRole !== "owner") {
      throw new Error("Alice must own the Koala Lab group.");
    }
    return matches[0];
  }
  return createGroup(alice.client, alice.user.id, {
    name: GROUP_NAME,
    description: "A shared reading room for papers on attention and machine learning.",
  });
}

async function ensureBobMembership(
  bob: DemoIdentity,
  groupId: string,
  inviteCode: string,
): Promise<void> {
  const { data, error } = await bob.client
    .from("group_memberships")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", bob.user.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not check Bob's group membership: ${error.message}`);
  }
  if (!data) {
    await joinGroup(bob.client, bob.user.id, inviteCode);
  }
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function ensurePaper(
  alice: DemoIdentity,
  admin: ReturnType<typeof createAdminClient>,
  groupId: string,
  pdfBytes: Buffer,
): Promise<string> {
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const { data: existing, error: paperLookupError } = await admin
    .from("papers")
    .select("id")
    .eq("pdf_sha256", pdfSha256)
    .maybeSingle();
  if (paperLookupError) {
    throw new Error(`Could not find fixture paper: ${paperLookupError.message}`);
  }
  if (existing) {
    const { data: link, error: linkLookupError } = await admin
      .from("group_papers")
      .select("paper_id")
      .eq("group_id", groupId)
      .eq("paper_id", existing.id)
      .maybeSingle();
    if (linkLookupError) {
      throw new Error(`Could not find fixture paper link: ${linkLookupError.message}`);
    }
    if (link) {
      return existing.id;
    }
  }

  const imported = await uploadPaper(
    alice.client,
    alice.user,
    groupId,
    {
      name: `${ARXIV_ID}.pdf`,
      arrayBuffer: async () => bytesToArrayBuffer(pdfBytes),
    },
    {
      title: PAPER_TITLE,
      authors: [
        "Ashish Vaswani",
        "Noam Shazeer",
        "Niki Parmar",
        "Jakob Uszkoreit",
        "Llion Jones",
        "Aidan N. Gomez",
        "Łukasz Kaiser",
        "Illia Polosukhin",
      ],
      year: 2017,
      doi: "10.48550/arXiv.1706.03762",
      tags: ["attention", "transformers"],
    },
    { arxivId: ARXIV_ID },
  );
  return imported.paperId;
}

async function ensurePaperAbstract(
  admin: ReturnType<typeof createAdminClient>,
  paperId: string,
): Promise<void> {
  const { error } = await admin
    .from("papers")
    .update({ abstract: PAPER_ABSTRACT })
    .eq("id", paperId);
  if (error) {
    throw new Error(`Could not set fixture paper abstract: ${error.message}`);
  }
}

async function processPaperIfNeeded(
  admin: ReturnType<typeof createAdminClient>,
  paperId: string,
): Promise<void> {
  const { data: paper, error: paperError } = await admin
    .from("papers")
    .select("processing_status")
    .eq("id", paperId)
    .maybeSingle();
  if (paperError || !paper) {
    throw new Error(
      `Could not inspect paper processing status: ${paperError?.message ?? "paper not found"}`,
    );
  }
  const { count, error: referencesError } = await admin
    .from("paper_references")
    .select("id", { count: "exact", head: true })
    .eq("paper_id", paperId);
  if (referencesError) {
    throw new Error(`Could not count paper references: ${referencesError.message}`);
  }

  if (
    process.argv.includes("--reprocess") ||
    paper.processing_status !== "ready" ||
    count === 0
  ) {
    await startPaperProcessing(paperId);
    return;
  }
  console.log("Skipping citation processing: paper is ready and has references.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQuote(quote: string): string {
  return quote.toLowerCase().replace(/\s+/gu, "");
}

function findAnchor(
  extracted: Awaited<ReturnType<typeof extractPdf>>,
  phrase: string,
  pageIndexHint?: number,
): AnnotationAnchorType {
  const patternSource =
    phrase
      .trim()
      .split(/\s+/u)
      .map(escapeRegExp)
      .join("\\s*");
  const sectionHeadingPrefix = /\b\d+(?:\.\d+)+\s*$/u;
  const makeAnchor = (
    page: (typeof extracted.pages)[number],
    match: RegExpMatchArray,
  ): AnnotationAnchorType | null => {
    if (match.index === undefined) {
      return null;
    }
    const start = match.index;
    const end = start + match[0].length;
    const rects = page.items
      .filter(
        (item) =>
          item.start < end &&
          item.end > start &&
          item.rect.w > 0 &&
          item.rect.h > 0,
      )
      .map((item) => item.rect);
    return AnnotationAnchor.parse({
      version: 1,
      pageIndex: page.pageIndex,
      rects,
      quote: {
        exact: page.text.slice(start, end),
        prefix: page.text.slice(Math.max(0, start - 64), start),
        suffix: page.text.slice(end, end + 64),
      },
      position: { start, end },
    });
  };

  const hintedPage = extracted.pages.find(
    (page) => page.pageIndex === pageIndexHint,
  );
  if (hintedPage) {
    for (const match of hintedPage.text.matchAll(
      new RegExp(patternSource, "giu"),
    )) {
      if (
        match.index !== undefined &&
        sectionHeadingPrefix.test(
          hintedPage.text.slice(Math.max(0, match.index - 24), match.index),
        )
      ) {
        const anchor = makeAnchor(hintedPage, match);
        if (anchor) {
          return anchor;
        }
      }
    }
  }

  for (const page of extracted.pages) {
    const match = new RegExp(patternSource, "iu").exec(page.text);
    if (match) {
      const anchor = makeAnchor(page, match);
      if (anchor) {
        return anchor;
      }
    }
  }
  throw new Error(`Could not find anchor text in the PDF: ${phrase}`);
}

const SHARED_ANNOTATION_PHRASES: {
  phrase: string;
  pageIndexHint?: number;
}[] = [
  { phrase: "Scaled Dot-Product Attention", pageIndexHint: 3 },
  { phrase: "Multi-Head Attention", pageIndexHint: 3 },
  {
    phrase:
      "We chose the sinusoidal version because it may allow the model to extrapolate to sequence lengths longer than the ones encountered during training.",
  },
  {
    phrase:
      "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU.",
  },
];

async function ensureSharedAnnotations(
  alice: DemoIdentity,
  groupId: string,
  paperId: string,
  anchors: AnnotationAnchorType[],
): Promise<Annotation[]> {
  const annotations = await listAnnotations(
    alice.client,
    alice.user,
    groupId,
    paperId,
  );
  const result: Annotation[] = [];
  const colors = ["yellow", "blue", "green", "purple"] as const;
  for (const [index, anchor] of anchors.entries()) {
    const normalizedQuote = normalizeQuote(anchor.quote.exact);
    const matching = annotations.filter(
      (annotation) =>
        annotation.visibility === "group" &&
        normalizeQuote(annotation.anchor.quote.exact) === normalizedQuote,
    );
    const existing = matching.find(
      (annotation) => annotation.anchor.pageIndex === anchor.pageIndex,
    );
    for (const outdated of matching.filter(
      (annotation) =>
        annotation.author.id === alice.user.id &&
        annotation.anchor.pageIndex !== anchor.pageIndex,
    )) {
      await deleteAnnotation(alice.client, alice.user, outdated.id);
      const outdatedIndex = annotations.findIndex(
        (annotation) => annotation.id === outdated.id,
      );
      if (outdatedIndex >= 0) {
        annotations.splice(outdatedIndex, 1);
      }
    }
    if (existing) {
      result.push(existing);
      continue;
    }
    const created = await createAnnotation(
      alice.client,
      alice.user,
      groupId,
      paperId,
      { visibility: "group", color: colors[index]!, anchor },
    );
    annotations.push(created);
    result.push(created);
  }
  return result;
}

async function ensureBobPrivateAnnotation(
  bob: DemoIdentity,
  groupId: string,
  paperId: string,
  anchor: AnnotationAnchorType,
): Promise<Annotation> {
  const annotations = await listAnnotations(
    bob.client,
    bob.user,
    groupId,
    paperId,
  );
  const normalizedQuote = normalizeQuote(anchor.quote.exact);
  const matching = annotations.filter(
    (annotation) =>
      annotation.visibility === "private" &&
      annotation.author.id === bob.user.id &&
      normalizeQuote(annotation.anchor.quote.exact) === normalizedQuote,
  );
  const existing = matching.find(
    (annotation) => annotation.anchor.pageIndex === anchor.pageIndex,
  );
  for (const outdated of matching.filter(
    (annotation) => annotation.anchor.pageIndex !== anchor.pageIndex,
  )) {
    await deleteAnnotation(bob.client, bob.user, outdated.id);
  }
  if (existing && existing.anchor.pageIndex === anchor.pageIndex) {
    return existing;
  }
  return createAnnotation(bob.client, bob.user, groupId, paperId, {
    visibility: "private",
    color: "pink",
    anchor,
  });
}

async function ensureThread(
  alice: DemoIdentity,
  bob: DemoIdentity,
  annotation: Annotation,
): Promise<void> {
  const rootBody =
    "The scaled dot-product formulation makes the attention weights easy to compare across tokens.";
  const replyBody =
    "Agreed. Dividing by the square root of the key dimension is the detail worth discussing.";
  const root = annotation.comments.find(
    (comment) =>
      comment.author.id === alice.user.id &&
      comment.body === rootBody &&
      !comment.deleted,
  );
  const rootId =
    root?.id ??
    (
      await addComment(alice.client, alice.user, annotation.id, {
        body: rootBody,
      })
    ).id;
  const hasReply = root?.replies.some(
    (reply) =>
      reply.author.id === bob.user.id &&
      reply.body === replyBody &&
      !reply.deleted,
  );
  if (!hasReply) {
    await addComment(bob.client, bob.user, annotation.id, {
      body: replyBody,
      parentId: rootId,
    });
  }
}

async function seed(): Promise<void> {
  const { url, anonKey } = loadLocalSupabaseEnvironment();
  const admin = createAdminClient();
  await ensureAuthUser(admin, ALICE);
  await ensureAuthUser(admin, BOB);

  const alice = await signIn(url, anonKey, ALICE);
  const bob = await signIn(url, anonKey, BOB);
  const group = await ensureGroup(alice);
  await ensureBobMembership(bob, group.id, group.inviteCode);

  const pdfPath = path.join(
    process.cwd(),
    "fixtures",
    "papers",
    ARXIV_ID,
    "paper.pdf",
  );
  const pdfBytes = readFileSync(pdfPath);
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error(`Fixture is not a PDF: ${pdfPath}`);
  }
  const extracted = await extractPdf(new Uint8Array(pdfBytes));
  const sharedAnchors = SHARED_ANNOTATION_PHRASES.map(
    ({ phrase, pageIndexHint }) =>
      findAnchor(extracted, phrase, pageIndexHint),
  );

  const paperId = await ensurePaper(alice, admin, group.id, pdfBytes);
  await ensurePaperAbstract(admin, paperId);
  await processPaperIfNeeded(admin, paperId);
  const shared = await ensureSharedAnnotations(
    alice,
    group.id,
    paperId,
    sharedAnchors,
  );
  const privateAnnotation = await ensureBobPrivateAnnotation(
    bob,
    group.id,
    paperId,
    sharedAnchors[1]!,
  );
  await ensureThread(alice, bob, shared[0]!);

  const { data: bobPrivate, error: bobReadError } = await bob.client
    .from("annotations")
    .select("id")
    .eq("id", privateAnnotation.id);
  if (bobReadError || !bobPrivate?.some((row) => row.id === privateAnnotation.id)) {
    throw new Error(
      `Bob could not read his private annotation: ${bobReadError?.message ?? "row missing"}`,
    );
  }
  const { data: alicePrivate, error: aliceReadError } = await alice.client
    .from("annotations")
    .select("id")
    .eq("id", privateAnnotation.id);
  if (aliceReadError || (alicePrivate?.length ?? 0) !== 0) {
    throw new Error(
      `RLS check failed: Alice can read Bob's private annotation${aliceReadError ? ` (${aliceReadError.message})` : ""}.`,
    );
  }

  const reviews = await listReviews(alice.client, alice.user, group.id, paperId);
  if (!reviews.some((review) => review.author.id === alice.user.id)) {
    await upsertMyReview(alice.client, alice.user, group.id, paperId, {
      tldr: "The Transformer replaces recurrence with attention and enables more parallel training.",
      contributions: [
        "A sequence transduction architecture based solely on attention.",
        "Multi-head attention and positional encodings for sequence order.",
      ],
      strengths: ["Clear architecture", "Strong translation results"],
      weaknesses: ["The original evaluation focuses on two translation tasks"],
      findings: ["28.4 BLEU on WMT 2014 English-to-German"],
      openQuestions: ["How does the architecture generalize beyond machine translation?"],
      relevance: "A foundational reference for our shared attention reading list.",
    });
  }

  console.log(`Seeded ${GROUP_NAME} with ${PAPER_TITLE} (arXiv:${ARXIV_ID}).`);
  console.log("RLS check passed: Alice cannot read Bob's private annotation.");
  console.log(`Alice: ${ALICE.email} / ${DEMO_PASSWORD} (group owner)`);
  console.log(`Bob:   ${BOB.email} / ${DEMO_PASSWORD} (group member)`);
}

seed().catch((error: unknown) => {
  console.error(
    "Demo seed failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
