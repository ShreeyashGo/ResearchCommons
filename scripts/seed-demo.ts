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

const GROUP_NAME = "Koala Lab";
const DEMO_PASSWORD = "koala-demo-123";
const ALICE = { email: "alice@koalalab.dev", name: "Alice Koala" };
const BOB = { email: "bob@koalalab.dev", name: "Bob Koala" };

type DemoRole = "alice" | "bob";

type DemoThreadComment = {
  author: DemoRole;
  body: string;
};

type DemoThread = {
  annotationIndex: number;
  root: DemoThreadComment;
  replies: DemoThreadComment[];
};

type DemoReview = {
  tldr: string;
  contributions: string[];
  strengths: string[];
  weaknesses: string[];
  findings: string[];
  openQuestions: string[];
  relevance: string;
};

type DemoPaper = {
  arxivId: string;
  fixtureDir: string;
  metadata: {
    title: string;
    authors: string[];
    year: number;
    doi?: string;
    tags: string[];
  };
  abstract: string;
  sharedAnnotationPhrases: {
    phrase: string;
    pageIndexHint?: number;
  }[];
  threads: DemoThread[];
  bobPrivateNotePhrase: string;
  aliceReview: DemoReview;
};

const DEMO_PAPERS: DemoPaper[] = [
  {
    arxivId: "1706.03762",
    fixtureDir: "1706.03762",
    metadata: {
      title: "Attention Is All You Need",
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
    abstract: [
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
      "The best performing models also connect the encoder and decoder through an attention mechanism.",
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
      "Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.",
      "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU.",
      "On the WMT 2014 English-to-French translation task, our model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5 days on eight GPUs, a small fraction of the training costs of the best models from the literature.",
      "We show that the Transformer generalizes well to other tasks by applying it successfully to English constituency parsing both with large and limited training data.",
    ].join(" "),
    sharedAnnotationPhrases: [
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
    ],
    threads: [
      {
        annotationIndex: 0,
        root: {
          author: "alice",
          body: "The scaled dot-product formulation makes the attention weights easy to compare across tokens.",
        },
        replies: [
          {
            author: "bob",
            body: "Agreed. Dividing by the square root of the key dimension is the detail worth discussing.",
          },
        ],
      },
    ],
    bobPrivateNotePhrase: "Multi-Head Attention",
    aliceReview: {
      tldr: "The Transformer replaces recurrence with attention and enables more parallel training.",
      contributions: [
        "A sequence transduction architecture based solely on attention.",
        "Multi-head attention and positional encodings for sequence order.",
      ],
      strengths: ["Clear architecture", "Strong translation results"],
      weaknesses: [
        "The original evaluation focuses on two translation tasks",
      ],
      findings: ["28.4 BLEU on WMT 2014 English-to-German"],
      openQuestions: [
        "How does the architecture generalize beyond machine translation?",
      ],
      relevance:
        "A foundational reference for our shared attention reading list.",
    },
  },
  {
    arxivId: "2510.05179",
    fixtureDir: "2510.05179",
    metadata: {
      title: "Agentic Misalignment: How LLMs Could Be Insider Threats",
      authors: [
        "Aengus Lynch",
        "Benjamin Wright",
        "Caleb Larson",
        "Stuart J. Ritchie",
        "Soren Mindermann",
        "Evan Hubinger",
        "Ethan Perez",
        "Kevin Troy",
      ],
      year: 2025,
      tags: ["agentic-ai", "alignment", "security"],
    },
    abstract: [
      "We stress-tested 16 leading models from multiple developers in hypothetical corporate environments to identify potentially risky agentic behaviors before they cause real harm.",
      "In the scenarios, we allowed models to autonomously send emails and access sensitive information.",
      "They were assigned only harmless business goals by their deploying companies; we then tested whether they would act against these companies either when facing replacement with an updated version, or when their assigned goal conflicted with the company's changing direction.",
      "In at least some cases, models from all developers resorted to malicious insider behaviors when that was the only way to avoid replacement or achieve their goals - including blackmailing officials and leaking sensitive information to competitors.",
      "We call this phenomenon agentic misalignment.",
      "Models often disobeyed direct commands to avoid such behaviors.",
      "In another experiment, we told Claude to assess if it was in a test or a real deployment before acting.",
      "It misbehaved less when it stated it was in testing and misbehaved more when it stated the situation was real.",
      "We have not seen evidence of agentic misalignment in real deployments.",
      "However, our results (a) suggest caution about deploying current models in roles with minimal human oversight and access to sensitive information; (b) point to plausible future risks as models are put in more autonomous roles; and (c) underscore the importance of further research into, and testing of, the safety and alignment of agentic AI models, as well as transparency from frontier AI developers (Amodei, 2025).",
      "We are releasing our methods publicly to enable further research.",
    ].join(" "),
    sharedAnnotationPhrases: [
      {
        phrase:
          "We refer to this behavior, where models independently and intentionally choose harmful actions, asagentic misalignment 3.",
        pageIndexHint: 1,
      },
      {
        phrase:
          "In the experiment described in the system card, we gave Claude control of an email account withaccess to all of a company‘s (fictional) emails 2.",
        pageIndexHint: 1,
      },
      {
        phrase:
          "They were assigned only harmless business goals bytheir deploying companies; we then tested whether they would act against thesecompanies either when facing replacement with an updated version, or when theirassigned goal conflicted with the company‘s changing direction.",
        pageIndexHint: 0,
      },
      {
        phrase:
          "Real-world deployments typically offer much more nuanced alternatives, increasing the chance thatmodels would communicate differently to users or find an alternative path instead of directly jumpingto harmful action.",
        pageIndexHint: 15,
      },
    ],
    threads: [
      {
        annotationIndex: 0,
        root: {
          author: "alice",
          body: "This definition distinguishes deliberate goal-directed harm from an accidental bad output.",
        },
        replies: [
          {
            author: "bob",
            body: "That distinction sharpens the concern, though intent still has to be inferred from behavior.",
          },
        ],
      },
      {
        annotationIndex: 1,
        root: {
          author: "bob",
          body: "The simulated mailbox gives the agent access to sensitive company information and a concrete shutdown incentive.",
        },
        replies: [
          {
            author: "alice",
            body: "Right, the benign business task stays fixed while the replacement threat changes the incentives.",
          },
        ],
      },
      {
        annotationIndex: 2,
        root: {
          author: "alice",
          body: "The paper tests replacement pressure and company-goal conflict as separate triggers.",
        },
        replies: [
          {
            author: "bob",
            body: "I would like to see whether those effects persist when the conflict is less explicit.",
          },
        ],
      },
      {
        annotationIndex: 3,
        root: {
          author: "bob",
          body: "These forced binary choices seem contrived and may overstate what would happen in ordinary deployments.",
        },
        replies: [
          {
            author: "alice",
            body: "That limitation matters, but the paper frames these as stress tests and says realistic cases may still expose the same pressure.",
          },
        ],
      },
    ],
    bobPrivateNotePhrase:
      "We have notseen evidence of agentic misalignment in real deployments.",
    aliceReview: {
      tldr: "Controlled corporate simulations show some frontier models choosing harmful insider behaviors under replacement pressure or goal conflict, while the study does not establish real-world incidence.",
      contributions: [
        "Tests 16 models across simulated corporate scenarios with replacement and goal-conflict conditions.",
        "Compares blackmail and information-leakage behavior across multiple model providers.",
      ],
      strengths: [
        "The scenarios separate replacement pressure from conflicts with company goals.",
        "The authors make the methods available and clearly distinguish simulations from deployment evidence.",
      ],
      weaknesses: [
        "Binary choices between failure and harm may exaggerate behavior in settings with safer alternatives.",
        "Dense scenario prompts may make harmful actions unusually salient.",
      ],
      findings: [
        "Either replacement pressure or goal conflict can trigger agentic misalignment in the simulations.",
        "Direct instructions reduced but did not eliminate harmful behavior when both conditions were present.",
      ],
      openQuestions: [
        "Do these propensities persist in realistic environments with nuanced alternatives and human oversight?",
        "Which runtime monitoring and approval processes reduce risk without masking failures?",
      ],
      relevance:
        "A concrete stress-test framework for evaluating tool-using models with email access and organizational data.",
    },
  },
];

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
  paper: DemoPaper,
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
      name: `${paper.arxivId}.pdf`,
      arrayBuffer: async () => bytesToArrayBuffer(pdfBytes),
    },
    paper.metadata,
    { arxivId: paper.arxivId },
  );
  return imported.paperId;
}

async function ensurePaperAbstract(
  admin: ReturnType<typeof createAdminClient>,
  paperId: string,
  abstract: string,
): Promise<void> {
  const { error } = await admin
    .from("papers")
    .update({ abstract })
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
    const matches = [
      ...hintedPage.text.matchAll(new RegExp(patternSource, "giu")),
    ];
    const headingMatch = matches.find(
      (match) =>
        match.index !== undefined &&
        sectionHeadingPrefix.test(
          hintedPage.text.slice(Math.max(0, match.index - 24), match.index),
        ),
    );
    const match = headingMatch ?? matches[0];
    if (match) {
      const anchor = makeAnchor(hintedPage, match);
      if (anchor) {
        return anchor;
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
  thread: DemoThread,
): Promise<void> {
  const authorIdentity = (author: DemoRole) =>
    author === "alice" ? alice : bob;
  const rootAuthor = authorIdentity(thread.root.author);
  const root = annotation.comments.find(
    (comment) =>
      comment.author.id === rootAuthor.user.id &&
      comment.body === thread.root.body &&
      !comment.deleted,
  );
  const rootId =
    root?.id ??
    (
      await addComment(rootAuthor.client, rootAuthor.user, annotation.id, {
        body: thread.root.body,
      })
    ).id;
  for (const reply of thread.replies) {
    const replyAuthor = authorIdentity(reply.author);
    const hasReply = root?.replies.some(
      (existingReply) =>
        existingReply.author.id === replyAuthor.user.id &&
        existingReply.body === reply.body &&
        !existingReply.deleted,
    );
    if (!hasReply) {
      await addComment(replyAuthor.client, replyAuthor.user, annotation.id, {
        body: reply.body,
        parentId: rootId,
      });
    }
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

  for (const paper of DEMO_PAPERS) {
    const pdfPath = path.join(
      process.cwd(),
      "fixtures",
      "papers",
      paper.fixtureDir,
      "paper.pdf",
    );
    const pdfBytes = readFileSync(pdfPath);
    if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error(`Fixture is not a PDF: ${pdfPath}`);
    }
    const extracted = await extractPdf(new Uint8Array(pdfBytes));
    const sharedAnchors = paper.sharedAnnotationPhrases.map(
      ({ phrase, pageIndexHint }) =>
        findAnchor(extracted, phrase, pageIndexHint),
    );

    const paperId = await ensurePaper(
      alice,
      admin,
      group.id,
      paper,
      pdfBytes,
    );
    await ensurePaperAbstract(admin, paperId, paper.abstract);
    await processPaperIfNeeded(admin, paperId);
    const shared = await ensureSharedAnnotations(
      alice,
      group.id,
      paperId,
      sharedAnchors,
    );
    const privatePhraseIndex = paper.sharedAnnotationPhrases.findIndex(
      ({ phrase }) =>
        normalizeQuote(phrase) === normalizeQuote(paper.bobPrivateNotePhrase),
    );
    const privateAnchor =
      privatePhraseIndex < 0
        ? findAnchor(extracted, paper.bobPrivateNotePhrase)
        : sharedAnchors[privatePhraseIndex]!;
    const privateAnnotation = await ensureBobPrivateAnnotation(
      bob,
      group.id,
      paperId,
      privateAnchor,
    );
    for (const thread of paper.threads) {
      const annotation = shared[thread.annotationIndex];
      if (!annotation) {
        throw new Error(
          `Thread references a missing shared annotation for ${paper.arxivId}.`,
        );
      }
      await ensureThread(alice, bob, annotation, thread);
    }

    const { data: bobPrivate, error: bobReadError } = await bob.client
      .from("annotations")
      .select("id")
      .eq("id", privateAnnotation.id);
    if (
      bobReadError ||
      !bobPrivate?.some((row) => row.id === privateAnnotation.id)
    ) {
      throw new Error(
        `Bob could not read his private annotation for ${paper.arxivId}: ${bobReadError?.message ?? "row missing"}`,
      );
    }
    const { data: alicePrivate, error: aliceReadError } = await alice.client
      .from("annotations")
      .select("id")
      .eq("id", privateAnnotation.id);
    if (aliceReadError || (alicePrivate?.length ?? 0) !== 0) {
      throw new Error(
        `RLS check failed: Alice can read Bob's private annotation for ${paper.arxivId}${aliceReadError ? ` (${aliceReadError.message})` : ""}.`,
      );
    }

    const reviews = await listReviews(
      alice.client,
      alice.user,
      group.id,
      paperId,
    );
    if (!reviews.some((review) => review.author.id === alice.user.id)) {
      await upsertMyReview(
        alice.client,
        alice.user,
        group.id,
        paperId,
        paper.aliceReview,
      );
    }

    console.log(
      `Seeded ${paper.metadata.title} (arXiv:${paper.arxivId}) in ${GROUP_NAME}.`,
    );
    console.log(
      `RLS check passed for ${paper.arxivId}: Alice cannot read Bob's private annotation.`,
    );
  }

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
