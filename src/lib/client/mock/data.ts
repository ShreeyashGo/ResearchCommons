import type {
  Annotation,
  CitationContext,
  CommentThread,
  DashboardResponse,
  ExternalWork,
  Group,
  GroupDetail,
  LibraryPaper,
  ProfileSummary,
  Reference,
  Review,
} from "@/contracts";
import { buildMockPdf, type MockPdfSpec } from "./pdf";

export const MOCK_USER: ProfileSummary & { email: string } = {
  id: "f0000000-0000-4000-8000-000000000001",
  displayName: "Ada Lovelace",
  email: "ada@researchcommons.local",
};

export const ALAN: ProfileSummary = {
  id: "f0000000-0000-4000-8000-000000000002",
  displayName: "Alan Turing",
};
export const KATHERINE: ProfileSummary = {
  id: "f0000000-0000-4000-8000-000000000003",
  displayName: "Katherine Johnson",
};
export const EDSGER: ProfileSummary = {
  id: "f0000000-0000-4000-8000-000000000004",
  displayName: "Edsger Dijkstra",
};

export const G1 = "f1000000-0000-4000-8000-000000000001";
export const G2 = "f1000000-0000-4000-8000-000000000002";
export const P1 = "f2000000-0000-4000-8000-000000000001";
export const P2 = "f2000000-0000-4000-8000-000000000002";
export const P3 = "f2000000-0000-4000-8000-000000000003";

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const uid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Mock paper content — rendered into a real PDF at runtime.
// ---------------------------------------------------------------------------

export const PAPER1_SPEC: MockPdfSpec = {
  title: "Scaling Attention for Long-Context Retrieval",
  pages: [
    [
      { text: "Scaling Attention for Long-Context Retrieval:", size: 15 },
      { text: "A Practical Study of Sparse Patterns", size: 15 },
      { text: "", size: 6 },
      { text: "M. Okafor, L. Brandt, S. Iyer, R. Costa", size: 10 },
      { text: "Workshop on Efficient Sequence Models, 2024", size: 9 },
      { text: "", size: 10 },
      { text: "Abstract", size: 12 },
      { text: "We study how sparse attention patterns behave when the input" },
      { text: "context grows beyond one hundred thousand tokens. Standard" },
      { text: "dense attention scales quadratically, which makes naive" },
      { text: "long-context inference impractical on commodity hardware." },
      { text: "We evaluate three sparse families on a retrieval benchmark" },
      { text: "we release with this paper, and show that routed sparsity" },
      { text: "recovers 97% of dense accuracy at a fifth of the compute." },
      { text: "", size: 8 },
      { text: "1  Introduction", size: 12 },
      { text: "Transformer language models dominate sequence modelling." },
      { text: "Since Vaswani et al. [1] introduced the architecture, the" },
      { text: "community has pushed context windows from 512 tokens to" },
      { text: "millions. Yet the cost of the attention operator has not" },
      { text: "changed: every token still attends to every other token." },
      { text: "Our goal in this paper is a pragmatic one — given a fixed" },
      { text: "hardware budget, which sparse pattern retrieves best?" },
      { text: "We make three contributions. First, a controlled comparison" },
      { text: "of block, strided, and routed sparsity at identical FLOPs." },
      { text: "Second, a retrieval benchmark built from 2,400 real" },
      { text: "literature questions. Third, an analysis of where sparse" },
      { text: "models still fail on genuinely long-range dependencies." },
    ],
    [
      { text: "2  Related Work", size: 12 },
      { text: "The quadratic cost of attention was identified early; [1]" },
      { text: "already noted memory as the limiting factor for long" },
      { text: "sequences. Pretraining with masked objectives [2] showed" },
      { text: "that bidirectional context improves downstream transfer," },
      { text: "and alignment models [3] first demonstrated that attention" },
      { text: "itself can be a learned, content-dependent routing." },
      { text: "Retrieval-augmented approaches, including dense passage" },
      { text: "retrieval [5], sidestep long context by fetching evidence" },
      { text: "instead of encoding it. Our benchmark borrows the DPR" },
      { text: "evaluation protocol but swaps web passages for papers." },
      { text: "", size: 8 },
      { text: "3  Method", size: 12 },
      { text: "Let n denote the sequence length and d the head" },
      { text: "dimension. Dense attention computes an n x n matrix of" },
      { text: "scores. We compare three sparsifiers that keep the same" },
      { text: "budget of 2n sqrt(n) score computations per head." },
      { text: "Block sparsity partitions the matrix into tiles. Strided" },
      { text: "sparsity keeps every k-th row and column. Routed sparsity" },
      { text: "learns a small routing network that selects, per query," },
      { text: "which key blocks to score — a learned variant of the" },
      { text: "alignment mechanism described in [3]." },
    ],
    [
      { text: "4  Experiments", size: 12 },
      { text: "All models are trained from the same checkpoint and the" },
      { text: "same data budget. We reuse the fine-tuning recipe of" },
      { text: "(Devlin et al., 2019) without modification, since our aim" },
      { text: "is a controlled sparsity comparison rather than a new" },
      { text: "state of the art. Table 1 reports retrieval recall." },
      { text: "", size: 6 },
      { text: "Routed sparsity clearly dominates: it matches dense" },
      { text: "attention within 3 points while using 5x less compute." },
      { text: "The gap to block sparsity widens with context length," },
      { text: "suggesting learned routing exploits structure that" },
      { text: "fixed patterns cannot. Surprisingly, [4] reports the" },
      { text: "opposite trend on synthetic data, which we attribute" },
      { text: "to the uniform key distribution in their benchmark." },
      { text: "", size: 8 },
      { text: "Table 1. Retrieval recall@10 at 128k tokens." },
      { text: "Dense 0.84   Block 0.61   Strided 0.66   Routed 0.81" },
      { text: "", size: 6 },
      { text: "Failures cluster around multi-hop questions: queries" },
      { text: "requiring two or more retrieval hops to compose an" },
      { text: "answer remain hard for every sparse variant we tested." },
    ],
    [
      { text: "5  Conclusion", size: 12 },
      { text: "Learned, content-dependent routing is the most effective" },
      { text: "sparsifier we evaluated, echoing the original motivation" },
      { text: "of attention as content routing [3]. We release the" },
      { text: "benchmark and evaluation harness to encourage comparable" },
      { text: "reporting across future sparse attention papers." },
      { text: "", size: 8 },
      { text: "References", size: 12 },
      { text: "[1] Vaswani, A., Shazeer, N., Parmar, N., et al. Attention", size: 9 },
      { text: "    is all you need. NeurIPS, 2017.", size: 9 },
      { text: "[2] Devlin, J., Chang, M., Lee, K., Toutanova, K. BERT:", size: 9 },
      { text: "    pre-training of deep bidirectional transformers.", size: 9 },
      { text: "    NAACL, 2019.", size: 9 },
      { text: "[3] Bahdanau, D., Cho, K., Bengio, Y. Neural machine", size: 9 },
      { text: "    translation by jointly learning to align and", size: 9 },
      { text: "    translate. ICLR, 2015.", size: 9 },
      { text: "[4] Okafor, M., Brandt, L. Synthetic long-context", size: 9 },
      { text: "    evaluation suite. Internal report, 2023.", size: 9 },
      { text: "[5] Karpukhin, V., et al. Dense passage retrieval for", size: 9 },
      { text: "    open-domain question answering. EMNLP, 2020.", size: 9 },
      { text: "[6] Press, O., Smith, N., Lewis, M. Train short, test", size: 9 },
      { text: "    long: ALiBi. ICLR, 2022.", size: 9 },
    ],
  ],
};

export const PAPER2_SPEC: MockPdfSpec = {
  title: "Contrastive Representations for Scientific Text",
  pages: [
    [
      { text: "Contrastive Representations for Scientific Text", size: 15 },
      { text: "", size: 6 },
      { text: "J. Renn, P. Almeida", size: 10 },
      { text: "", size: 10 },
      { text: "Abstract", size: 12 },
      { text: "We train a small contrastive encoder on citation pairs" },
      { text: "mined from open-access corpora. The encoder separates" },
      { text: "method citations from background citations, improving" },
      { text: "downstream literature search and deduplication." },
      { text: "", size: 8 },
      { text: "1  Overview", size: 12 },
      { text: "Scientific text embeds meaning in citation context as" },
      { text: "much as in prose. We treat a citing sentence and the" },
      { text: "cited abstract as a positive pair and sample negatives" },
      { text: "from the same section, following [2]." },
    ],
    [
      { text: "2  Results", size: 12 },
      { text: "On a held-out set of 40k pairs the model reaches 0.91" },
      { text: "contrastive accuracy, and fine-tuning on [6] style" },
      { text: "positional encodings degrades gracefully to 128k." },
      { text: "", size: 8 },
      { text: "References", size: 12 },
      { text: "[1] Vaswani, A., et al. Attention is all you need.", size: 9 },
      { text: "    NeurIPS, 2017.", size: 9 },
      { text: "[2] Devlin, J., et al. BERT. NAACL, 2019.", size: 9 },
      { text: "[6] Press, O., et al. Train short, test long. ICLR 2022.", size: 9 },
    ],
  ],
};

/** pdf bytes cache, keyed by paper id, plus the object URL we hand out. */
const pdfBytes = new Map<string, Uint8Array>();
const pdfUrls = new Map<string, string>();

export function mockPdfUrl(paperId: string): string {
  const existing = pdfUrls.get(paperId);
  if (existing) return existing;
  let bytes = pdfBytes.get(paperId);
  if (!bytes) {
    const spec = paperId === P1 ? PAPER1_SPEC : PAPER2_SPEC;
    bytes = buildMockPdf(spec);
    pdfBytes.set(paperId, bytes);
  }
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
  pdfUrls.set(paperId, url);
  return url;
}

export function pageCount(paperId: string): number {
  return paperId === P1 ? PAPER1_SPEC.pages.length : PAPER2_SPEC.pages.length;
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

export interface MockState {
  profile: ProfileSummary & { email: string };
  groups: Group[];
  groupDetails: Map<string, GroupDetail>;
  papers: Map<string, LibraryPaper>; // key `${gid}:${pid}`
  annotations: Map<string, Annotation[]>; // key `${gid}:${pid}`
  reviews: Map<string, Review[]>;
  references: Reference[];
  contexts: CitationContext[];
  aiCache: Map<string, unknown>;
}

function ref(
  id: string,
  ordinal: number,
  label: string | null,
  rawText: string,
  status: "resolved" | "unresolved" | "ambiguous",
  work?: Partial<ExternalWork>,
): Reference {
  return {
    id,
    paperId: P1,
    ordinal,
    label,
    rawText,
    parsedTitle: work?.title ?? null,
    parsedAuthors: work?.authors ?? [],
    parsedYear: work?.year ?? null,
    matchStatus: status,
    matchScore: status === "resolved" ? 0.94 : status === "ambiguous" ? 0.82 : null,
    matchMethod: status === "resolved" ? "s2_reference_list" : null,
    work:
      status === "resolved" && work
        ? {
            id: `f4000000-0000-4000-8000-00000000000${ordinal}`,
            source: "arxiv",
            externalId: work.arxivId ?? `ext-${ordinal}`,
            title: work.title ?? "",
            authors: work.authors ?? [],
            year: work.year ?? null,
            venue: work.venue ?? null,
            abstract: work.abstract ?? null,
            doi: work.doi ?? null,
            arxivId: work.arxivId ?? null,
            url: work.url ?? null,
            openAccessPdfUrl: work.openAccessPdfUrl ?? null,
          }
        : null,
    searchUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(rawText)}`,
  };
}

export function initialState(): MockState {
  const groups: Group[] = [
    {
      id: G1,
      name: "Robustness Lab",
      description: "Reading group on robust and efficient sequence models.",
      inviteCode: "lab42x9",
      myRole: "owner",
      memberCount: 4,
      paperCount: 3,
      createdAt: iso(60 * 24 * 12),
    },
    {
      id: G2,
      name: "ML Reading Group",
      description: "Weekly paper club — Fridays 3pm.",
      inviteCode: "friday3",
      myRole: "member",
      memberCount: 7,
      paperCount: 1,
      createdAt: iso(60 * 24 * 30),
    },
  ];

  const groupDetails = new Map<string, GroupDetail>([
    [
      G1,
      {
        ...groups[0],
        members: [
          { ...MOCK_USER, role: "owner", joinedAt: iso(60 * 24 * 12) },
          { ...ALAN, role: "member", joinedAt: iso(60 * 24 * 11) },
          { ...KATHERINE, role: "member", joinedAt: iso(60 * 24 * 9) },
          { ...EDSGER, role: "member", joinedAt: iso(60 * 24 * 2) },
        ],
      },
    ],
    [
      G2,
      {
        ...groups[1],
        members: [
          { ...KATHERINE, role: "owner", joinedAt: iso(60 * 24 * 30) },
          { ...MOCK_USER, role: "member", joinedAt: iso(60 * 24 * 20) },
          { ...ALAN, role: "member", joinedAt: iso(60 * 24 * 20) },
        ],
      },
    ],
  ]);

  const papers = new Map<string, LibraryPaper>();
  const put = (p: LibraryPaper) => papers.set(`${p.groupId}:${p.id}`, p);

  put({
    id: P1,
    groupId: G1,
    source: "arxiv",
    title: "Scaling Attention for Long-Context Retrieval",
    authors: ["M. Okafor", "L. Brandt", "S. Iyer", "R. Costa"],
    abstract:
      "We study how sparse attention patterns behave when the input context grows beyond one hundred thousand tokens, and evaluate three sparse families on a new retrieval benchmark.",
    year: 2024,
    doi: null,
    arxivId: "2407.10118",
    pageCount: PAPER1_SPEC.pages.length,
    processingStatus: "ready",
    processingError: null,
    createdAt: iso(60 * 24 * 4),
    tags: ["attention", "long-context"],
    addedBy: MOCK_USER,
    addedAt: iso(60 * 24 * 4),
    annotationCount: 3,
    reviewCount: 1,
  });
  put({
    id: P2,
    groupId: G1,
    source: "upload",
    title: "Contrastive Representations for Scientific Text",
    authors: ["J. Renn", "P. Almeida"],
    abstract:
      "A contrastive encoder trained on citation pairs that separates method citations from background citations.",
    year: 2023,
    doi: "10.1145/sci-text.23",
    arxivId: null,
    pageCount: PAPER2_SPEC.pages.length,
    processingStatus: "ready",
    processingError: null,
    createdAt: iso(60 * 24 * 6),
    tags: ["embeddings"],
    addedBy: KATHERINE,
    addedAt: iso(60 * 24 * 6),
    annotationCount: 0,
    reviewCount: 0,
  });
  put({
    id: P3,
    groupId: G1,
    source: "arxiv",
    title: "A Survey of Self-Supervised Vision Transformers",
    authors: ["T. Nguyen", "H. Park", "F. Duarte"],
    abstract: null,
    year: 2024,
    doi: null,
    arxivId: "2403.08871",
    pageCount: null,
    processingStatus: "processing",
    processingError: null,
    createdAt: iso(90),
    tags: [],
    addedBy: ALAN,
    addedAt: iso(90),
    annotationCount: 0,
    reviewCount: 0,
  });
  put({
    ...{ ...papers.get(`${G1}:${P1}`)! },
    id: P1,
    groupId: G2,
    tags: ["attention"],
    addedBy: KATHERINE,
    addedAt: iso(60 * 24 * 8),
    annotationCount: 0,
    reviewCount: 0,
  });

  const comments1: CommentThread[] = [
    {
      id: "f3000000-0000-4000-8000-000000000011",
      annotationId: "f5000000-0000-4000-8000-000000000001",
      parentId: null,
      author: ALAN,
      body: "97% at a fifth of the compute is a strong claim. Did they control for routing overhead?",
      deleted: false,
      createdAt: iso(60 * 26),
      updatedAt: iso(60 * 26),
      replies: [
        {
          id: "f3000000-0000-4000-8000-000000000012",
          annotationId: "f5000000-0000-4000-8000-000000000001",
          parentId: "f3000000-0000-4000-8000-000000000011",
          author: KATHERINE,
          body: "Table 1 reports FLOPs including the router. I think it holds.",
          deleted: false,
          createdAt: iso(60 * 25),
          updatedAt: iso(60 * 25),
        },
      ],
    },
  ];

  const comments2: CommentThread[] = [
    {
      id: "f3000000-0000-4000-8000-000000000021",
      annotationId: "f5000000-0000-4000-8000-000000000002",
      parentId: null,
      author: KATHERINE,
      body: "This contradicts their synthetic-data claim later in section 4 — worth discussing Friday.",
      deleted: false,
      createdAt: iso(60 * 8),
      updatedAt: iso(60 * 8),
      replies: [],
    },
  ];

  const annotations = new Map<string, Annotation[]>();
  annotations.set(`${G1}:${P1}`, [
    {
      id: "f5000000-0000-4000-8000-000000000001",
      groupId: G1,
      paperId: P1,
      author: ALAN,
      visibility: "group",
      color: "yellow",
      anchor: {
        version: 1,
        pageIndex: 0,
        rects: [{ x: 0.1, y: 0.2, w: 0.7, h: 0.02 }],
        quote: {
          exact: "recovers 97% of dense accuracy at a fifth of the compute.",
          prefix: "we release with this paper, and show that routed sparsity",
          suffix: "      1  IntroductionTransformer language models domi",
        },
      },
      comments: comments1,
      createdAt: iso(60 * 26),
      updatedAt: iso(60 * 26),
    },
    {
      id: "f5000000-0000-4000-8000-000000000002",
      groupId: G1,
      paperId: P1,
      author: KATHERINE,
      visibility: "group",
      color: "blue",
      anchor: {
        version: 1,
        pageIndex: 1,
        rects: [{ x: 0.1, y: 0.3, w: 0.7, h: 0.02 }],
        quote: {
          exact: "which key blocks to score — a learned variant of the",
          prefix: "learns a small routing network that selects, per query,",
          suffix: "alignment mechanism described in [3].",
        },
      },
      comments: comments2,
      createdAt: iso(60 * 8),
      updatedAt: iso(60 * 8),
    },
    {
      id: "f5000000-0000-4000-8000-000000000003",
      groupId: G1,
      paperId: P1,
      author: MOCK_USER,
      visibility: "private",
      color: "green",
      anchor: {
        version: 1,
        pageIndex: 2,
        rects: [{ x: 0.1, y: 0.5, w: 0.7, h: 0.02 }],
        quote: {
          exact: "Failures cluster around multi-hop questions: queries",
          prefix: "    Table 1. Retrieval recall@10 at 128k tokens.",
          suffix: "requiring two or more retrieval hops to compose an",
        },
      },
      comments: [],
      createdAt: iso(45),
      updatedAt: iso(45),
    },
  ]);
  annotations.set(`${G2}:${P1}`, []);

  const reviews = new Map<string, Review[]>();
  reviews.set(`${G1}:${P1}`, [
    {
      id: "f6000000-0000-4000-8000-000000000001",
      groupId: G1,
      paperId: P1,
      author: KATHERINE,
      tldr: "Convincing case for routed sparsity; solid benchmark, thin failure analysis.",
      contributions: [
        "Controlled block/strided/routed comparison at identical FLOPs",
        "A 2,400-question literature retrieval benchmark",
      ],
      strengths: ["Clean experimental design", "Honest failure discussion in §4"],
      weaknesses: ["No latency numbers, only FLOPs", "Single random seed reported"],
      findings: ["Routed sparsity within 3 points of dense at 5x less compute"],
      openQuestions: ["Does routing hold up with domain shift to legal text?"],
      relevance: "Directly relevant to our long-context project — reuse their benchmark.",
      createdAt: iso(60 * 20),
      updatedAt: iso(60 * 5),
    },
  ]);
  reviews.set(`${G1}:${P2}`, []);
  reviews.set(`${G1}:${P3}`, []);
  reviews.set(`${G2}:${P1}`, []);

  const references: Reference[] = [
    ref("f7000000-0000-4000-8000-000000000001", 1, "1",
      "Vaswani, A., Shazeer, N., Parmar, N., et al. Attention is all you need. NeurIPS, 2017.",
      "resolved",
      {
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
        year: 2017,
        venue: "NeurIPS",
        arxivId: "1706.03762",
        url: "https://arxiv.org/abs/1706.03762",
        openAccessPdfUrl: "https://arxiv.org/pdf/1706.03762",
        abstract:
          "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
      }),
    ref("f7000000-0000-4000-8000-000000000002", 2, "2",
      "Devlin, J., Chang, M., Lee, K., Toutanova, K. BERT: pre-training of deep bidirectional transformers. NAACL, 2019.",
      "resolved",
      {
        title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        authors: ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
        year: 2019,
        venue: "NAACL",
        arxivId: "1810.04805",
        url: "https://arxiv.org/abs/1810.04805",
        abstract:
          "We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.",
      }),
    ref("f7000000-0000-4000-8000-000000000003", 3, "3",
      "Bahdanau, D., Cho, K., Bengio, Y. Neural machine translation by jointly learning to align and translate. ICLR, 2015.",
      "resolved",
      {
        title: "Neural Machine Translation by Jointly Learning to Align and Translate",
        authors: ["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"],
        year: 2015,
        venue: "ICLR",
        arxivId: "1409.0473",
        url: "https://arxiv.org/abs/1409.0473",
        abstract:
          "Neural machine translation is a recently proposed approach to machine translation. In this paper, we conjecture that the use of a fixed-length vector is a bottleneck.",
      }),
    ref("f7000000-0000-4000-8000-000000000004", 4, "4",
      "Okafor, M., Brandt, L. Synthetic long-context evaluation suite. Internal report, 2023.",
      "unresolved"),
    ref("f7000000-0000-4000-8000-000000000005", 5, "5",
      "Karpukhin, V., et al. Dense passage retrieval for open-domain question answering. EMNLP, 2020.",
      "ambiguous"),
    ref("f7000000-0000-4000-8000-000000000006", 6, "6",
      "Press, O., Smith, N., Lewis, M. Train short, test long: attention with linear biases. ICLR, 2022.",
      "resolved",
      {
        title: "Train Short, Test Long: Attention with Linear Biases Enables Input Length Extrapolation",
        authors: ["Ofir Press", "Noah A. Smith", "Mike Lewis"],
        year: 2022,
        venue: "ICLR",
        arxivId: "2108.12409",
        url: "https://arxiv.org/abs/2108.12409",
        abstract:
          "We present attention with linear biases (ALiBi), which biases attention scores with a penalty proportional to distance.",
      }),
  ];

  const contexts: CitationContext[] = [
    {
      id: "f8000000-0000-4000-8000-000000000001",
      referenceId: references[0].id,
      pageIndex: 0,
      markerText: "[1]",
      sentence:
        "Since Vaswani et al. [1] introduced the architecture, the community has pushed context windows from 512 tokens to millions.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000002",
      referenceId: references[0].id,
      pageIndex: 1,
      markerText: "[1]",
      sentence:
        "The quadratic cost of attention was identified early; [1] already noted memory as the limiting factor for long sequences.",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000003",
      referenceId: references[1].id,
      pageIndex: 1,
      markerText: "[2]",
      sentence:
        "Pretraining with masked objectives [2] showed that bidirectional context improves downstream transfer.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000004",
      referenceId: references[1].id,
      pageIndex: 2,
      markerText: "(Devlin et al., 2019)",
      sentence:
        "We reuse the fine-tuning recipe of (Devlin et al., 2019) without modification, since our aim is a controlled sparsity comparison.",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000005",
      referenceId: references[2].id,
      pageIndex: 1,
      markerText: "[3]",
      sentence:
        "Alignment models [3] first demonstrated that attention itself can be a learned, content-dependent routing.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000006",
      referenceId: references[3].id,
      pageIndex: 2,
      markerText: "[4]",
      sentence:
        "Surprisingly, [4] reports the opposite trend on synthetic data, which we attribute to the uniform key distribution in their benchmark.",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000007",
      referenceId: references[4].id,
      pageIndex: 1,
      markerText: "[5]",
      sentence:
        "Retrieval-augmented approaches, including dense passage retrieval [5], sidestep long context by fetching evidence.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000008",
      referenceId: references[5].id,
      pageIndex: 3,
      markerText: "[3]",
      sentence:
        "Learned, content-dependent routing is the most effective sparsifier we evaluated, echoing the original motivation of attention as content routing [3].",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
  ];

  return {
    profile: MOCK_USER,
    groups,
    groupDetails,
    papers,
    annotations,
    reviews,
    references,
    contexts,
    aiCache: new Map(),
  };
}

export function dashboardFixture(state: MockState, groupId: string): DashboardResponse {
  const groupPapers = [...state.papers.values()].filter((p) => p.groupId === groupId);
  const annotations = [...(state.annotations.get(`${G1}:${P1}`) ?? [])];
  const commentCount = annotations.reduce(
    (n, a) => n + a.comments.reduce((m, c) => m + 1 + c.replies.length, 0),
    0,
  );
  const reviews = state.reviews.get(`${groupId}:${P1}`) ?? [];
  return {
    stats: {
      papers: groupPapers.length,
      annotations: annotations.length,
      comments: commentCount,
      reviews: reviews.length,
      members: state.groupDetails.get(groupId)?.members.length ?? 1,
    },
    recentPapers: groupPapers
      .slice()
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .slice(0, 10),
    recentlyAnnotated: groupPapers.filter((p) => p.annotationCount > 0).slice(0, 10),
    activity: [
      {
        type: "review_saved",
        at: iso(60 * 5),
        actor: KATHERINE,
        paperId: P1,
        paperTitle: "Scaling Attention for Long-Context Retrieval",
        reviewId: "f6000000-0000-4000-8000-000000000001",
        tldr: "Convincing case for routed sparsity; solid benchmark, thin failure analysis.",
      },
      {
        type: "comment_created",
        at: iso(60 * 8),
        actor: KATHERINE,
        paperId: P1,
        paperTitle: "Scaling Attention for Long-Context Retrieval",
        annotationId: "f5000000-0000-4000-8000-000000000002",
        commentId: "f3000000-0000-4000-8000-000000000021",
        excerpt: "This contradicts their synthetic-data claim later in section 4…",
      },
      {
        type: "annotation_created",
        at: iso(60 * 26),
        actor: ALAN,
        paperId: P1,
        paperTitle: "Scaling Attention for Long-Context Retrieval",
        annotationId: "f5000000-0000-4000-8000-000000000001",
        quote: "recovers 97% of dense accuracy at a fifth of the compute.",
      },
      {
        type: "paper_added",
        at: iso(90),
        actor: ALAN,
        paperId: P3,
        paperTitle: "A Survey of Self-Supervised Vision Transformers",
      },
      {
        type: "paper_added",
        at: iso(60 * 24 * 6),
        actor: KATHERINE,
        paperId: P2,
        paperTitle: "Contrastive Representations for Scientific Text",
      },
    ],
  };
}

export { uid };
