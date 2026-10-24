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
  // ASCII-only lines: buildMockPdf maps any non-ASCII char to "?", and anchor
  // quotes below must match the generated page text verbatim.
  title: "Attention Is All You Need",
  pages: [
    [
      { text: "Attention Is All You Need", size: 15 },
      { text: "", size: 6 },
      { text: "Ashish Vaswani, Noam Shazeer, Niki Parmar,", size: 10 },
      { text: "Jakob Uszkoreit, Llion Jones, Aidan N. Gomez,", size: 10 },
      { text: "Lukasz Kaiser, Illia Polosukhin", size: 10 },
      { text: "NeurIPS, 2017", size: 9 },
      { text: "", size: 10 },
      { text: "Abstract", size: 12 },
      { text: "The dominant sequence transduction models are based on" },
      { text: "complex recurrent or convolutional neural networks that" },
      { text: "include an encoder and a decoder. The best performing" },
      { text: "models also connect the encoder and decoder through an" },
      { text: "attention mechanism. We propose a new simple network" },
      { text: "architecture, the Transformer, based solely on attention" },
      { text: "mechanisms, dispensing with recurrence and convolutions entirely." },
      { text: "", size: 8 },
      { text: "1  Introduction", size: 12 },
      { text: "Recurrent neural networks, long short-term memory and" },
      { text: "gated recurrent neural networks in particular have been" },
      { text: "firmly established as state of the art approaches in" },
      { text: "sequence modeling and transduction problems such as" },
      { text: "language modeling and machine translation. Numerous" },
      { text: "efforts have pushed the boundaries of recurrent language" },
      { text: "models and encoder-decoder architectures [16]." },
      { text: "", size: 6 },
      { text: "Attention mechanisms have become an integral part of" },
      { text: "compelling sequence modeling and transduction models," },
      { text: "allowing modeling of dependencies without regard to" },
      { text: "their distance in the input or output sequences. In all" },
      { text: "but a few cases, however, such attention mechanisms are" },
      { text: "used in conjunction with a recurrent network [2]." },
    ],
    [
      { text: "2  Background", size: 12 },
      { text: "The goal of reducing sequential computation also forms" },
      { text: "the foundation of the Extended Neural GPU [16], ByteNet" },
      { text: "[18] and ConvS2S [17], all of which use convolutional" },
      { text: "neural networks as basic building block, computing" },
      { text: "hidden representations in parallel for all input and" },
      { text: "output positions. In these models, the number of" },
      { text: "operations required to relate signals from two arbitrary" },
      { text: "input or output positions grows in the distance between" },
      { text: "positions." },
      { text: "", size: 6 },
      { text: "Self-attention, sometimes called intra-attention, is an" },
      { text: "attention mechanism relating different positions of a" },
      { text: "single sequence in order to compute a representation of" },
      { text: "the sequence. Self-attention has been used successfully" },
      { text: "in a variety of tasks [4]." },
      { text: "", size: 8 },
      { text: "3  Model Architecture", size: 12 },
      { text: "Most competitive neural sequence transduction models" },
      { text: "have an encoder-decoder structure. The encoder maps an" },
      { text: "input sequence to a sequence of continuous" },
      { text: "representations. The Transformer follows this overall" },
      { text: "architecture using stacked self-attention and point-wise," },
      { text: "fully connected layers for both encoder and decoder." },
    ],
    [
      { text: "4  Why Self-Attention", size: 12 },
      { text: "Self-attention layers connect all positions with a" },
      { text: "constant number of sequentially executed operations," },
      { text: "whereas a recurrent layer requires O(n) sequential" },
      { text: "operations. In terms of computational complexity," },
      { text: "self-attention layers are faster when the sequence" },
      { text: "length is smaller than the representation" },
      { text: "dimensionality." },
      { text: "", size: 6 },
      { text: "As a side benefit, self-attention could yield more" },
      { text: "interpretable models. We inspect attention" },
      { text: "distributions and show examples in the appendix:" },
      { text: "individual attention heads clearly learn to perform" },
      { text: "different tasks, exhibiting behaviour resembling the" },
      { text: "alignment model of [2]." },
      { text: "", size: 8 },
      { text: "5  Training", size: 12 },
      { text: "We trained on the standard WMT 2014 English-German" },
      { text: "dataset consisting of about 4.5 million sentence pairs," },
      { text: "and on the larger WMT 2014 English-French dataset of" },
      { text: "36M sentences, split into a 32000 word-piece vocabulary." },
      { text: "Our baselines are the published convolutional and" },
      { text: "attention models, including GNMT [35]." },
    ],
    [
      { text: "6  Results", size: 12 },
      { text: "On the WMT 2014 English-to-German translation task," },
      { text: "the big transformer model outperforms the best" },
      { text: "previously reported models by more than 2.0 BLEU," },
      { text: "establishing a new state-of-the-art BLEU score of 28.4." },
      { text: "On English-to-French, our big model achieves a BLEU" },
      { text: "score of 41.0, outperforming all previously published" },
      { text: "models at a fraction of the training cost." },
      { text: "", size: 8 },
      { text: "References", size: 12 },
      { text: "[2] Bahdanau, D., Cho, K., Bengio, Y. Neural machine", size: 9 },
      { text: "    translation by jointly learning to align and", size: 9 },
      { text: "    translate. ICLR, 2015.", size: 9 },
      { text: "[4] Sukhbaatar, S., Szlam, A., Weston, J., Fergus, R.", size: 9 },
      { text: "    End-to-end memory networks. NeurIPS, 2015.", size: 9 },
      { text: "[16] Kaiser, L., Bengio, S. Can active memory replace", size: 9 },
      { text: "    attention? NeurIPS, 2016.", size: 9 },
      { text: "[17] Gehring, J., Auli, M., Grangier, D., Yarats, D.,", size: 9 },
      { text: "    Dauphin, Y. Convolutional sequence to sequence", size: 9 },
      { text: "    learning. ICML, 2017.", size: 9 },
      { text: "[18] Kalchbrenner, N., et al. Neural machine", size: 9 },
      { text: "    translation in linear time (ByteNet). arXiv, 2016.", size: 9 },
      { text: "[35] Wu, Y., et al. Google's neural machine", size: 9 },
      { text: "    translation system. arXiv, 2016.", size: 9 },
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
      name: "Koala Lab",
      description: "Reading group on sequence models and attention.",
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
    title: "Attention Is All You Need",
    authors: [
      "Ashish Vaswani",
      "Noam Shazeer",
      "Niki Parmar",
      "Jakob Uszkoreit",
      "Llion Jones",
      "Aidan N. Gomez",
      "Lukasz Kaiser",
      "Illia Polosukhin",
    ],
    abstract:
      "We propose the Transformer, a simple network architecture based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
    year: 2017,
    doi: null,
    arxivId: "1706.03762",
    pageCount: PAPER1_SPEC.pages.length,
    processingStatus: "ready",
    processingError: null,
    createdAt: iso(60 * 24 * 4),
    tags: ["attention", "transformer"],
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
      body: "Dispensing with recurrence entirely is the bold claim here -- the compute argument lands in section 4.",
      deleted: false,
      createdAt: iso(60 * 26),
      updatedAt: iso(60 * 26),
      replies: [
        {
          id: "f3000000-0000-4000-8000-000000000012",
          annotationId: "f5000000-0000-4000-8000-000000000001",
          parentId: "f3000000-0000-4000-8000-000000000011",
          author: KATHERINE,
          body: "And it held up: every efficient-attention paper we read still cites this line.",
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
      body: "ConvS2S [17] is the baseline to beat here -- check the BLEU table in section 6.",
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
          exact: "dispensing with recurrence and convolutions entirely.",
          prefix: "attentionmechanisms, ",
          suffix: "1  IntroductionRecurrent neural",
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
          exact: "ConvS2S [17], all of which use convolutional",
          prefix: "ByteNet[18] and ",
          suffix: "neural networks as basic building bl",
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
          exact: "individual attention heads clearly learn to perform",
          prefix: "show examples in the appendix:",
          suffix: "different tasks, exhibiting behaviour",
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
      tldr: "Foundational transformer paper; the self-attention-only architecture and BLEU results held up.",
      contributions: [
        "Transformer: stacked multi-head self-attention, no recurrence",
        "28.4 BLEU En-De / 41.0 En-Fr, SOTA at lower training cost",
      ],
      strengths: ["Constant-depth path vs O(n) sequential ops is cleanly argued", "Training details are reproducible"],
      weaknesses: ["Quadratic attention cost not analyzed for long sequences", "Interpretability section is qualitative"],
      findings: ["Multi-head self-attention alone beats encoder-decoder RNNs and CNNs"],
      openQuestions: ["Where does attention efficiency break down past 100k tokens?"],
      relevance: "The reference baseline for every efficient-attention paper we review.",
      createdAt: iso(60 * 20),
      updatedAt: iso(60 * 5),
    },
  ]);
  reviews.set(`${G1}:${P2}`, []);
  reviews.set(`${G1}:${P3}`, []);
  reviews.set(`${G2}:${P1}`, []);

  const references: Reference[] = [
    ref("f7000000-0000-4000-8000-000000000002", 2, "2",
      "Bahdanau, D., Cho, K., Bengio, Y. Neural machine translation by jointly learning to align and translate. ICLR, 2015.",
      "resolved",
      {
        title: "Neural Machine Translation by Jointly Learning to Align and Translate",
        authors: ["Dzmitry Bahdanau", "Kyunghyun Cho", "Yoshua Bengio"],
        year: 2015,
        venue: "ICLR",
        arxivId: "1409.0473",
        url: "https://arxiv.org/abs/1409.0473",
        openAccessPdfUrl: "https://arxiv.org/pdf/1409.0473",
        abstract:
          "Neural machine translation is a recently proposed approach to machine translation. In this paper, we conjecture that the use of a fixed-length vector is a bottleneck.",
      }),
    ref("f7000000-0000-4000-8000-000000000004", 4, "4",
      "Sukhbaatar, S., Szlam, A., Weston, J., Fergus, R. End-to-end memory networks. NeurIPS, 2015.",
      "ambiguous"),
    ref("f7000000-0000-4000-8000-000000000016", 16, "16",
      "Kaiser, L., Bengio, S. Can active memory replace attention? NeurIPS, 2016.",
      "resolved",
      {
        title: "Can Active Memory Replace Attention?",
        authors: ["Lukasz Kaiser", "Samy Bengio"],
        year: 2016,
        venue: "NeurIPS",
        arxivId: "1605.06065",
        url: "https://arxiv.org/abs/1605.06065",
        openAccessPdfUrl: "https://arxiv.org/pdf/1605.06065",
        abstract:
          "We show that an active-memory model can replace attention for sequence-to-sequence learning, using the Extended Neural GPU.",
      }),
    ref("f7000000-0000-4000-8000-000000000017", 17, "17",
      "Gehring, J., Auli, M., Grangier, D., Yarats, D., Dauphin, Y. Convolutional sequence to sequence learning. ICML, 2017.",
      "resolved",
      {
        title: "Convolutional Sequence to Sequence Learning",
        authors: ["Jonas Gehring", "Michael Auli", "David Grangier", "Denis Yarats", "Yann N. Dauphin"],
        year: 2017,
        venue: "ICML",
        arxivId: "1705.03122",
        url: "https://arxiv.org/abs/1705.03122",
        openAccessPdfUrl: "https://arxiv.org/pdf/1705.03122",
        abstract:
          "We introduce an architecture based entirely on convolutional neural networks that achieves state-of-the-art accuracy on machine translation benchmarks.",
      }),
    ref("f7000000-0000-4000-8000-000000000018", 18, "18",
      "Kalchbrenner, N., Espeholt, L., Simonyan, K., Oord, A., Graves, A., Kavukcuoglu, K. Neural machine translation in linear time. arXiv, 2016.",
      "resolved",
      {
        title: "Neural Machine Translation in Linear Time (ByteNet)",
        authors: ["Nal Kalchbrenner", "Lasse Espeholt", "Karen Simonyan", "Aaron van den Oord", "Alex Graves", "Koray Kavukcuoglu"],
        year: 2016,
        venue: null,
        arxivId: "1610.10099",
        url: "https://arxiv.org/abs/1610.10099",
        openAccessPdfUrl: "https://arxiv.org/pdf/1610.10099",
        abstract:
          "We present ByteNet, a one-dimensional convolutional neural network that achieves state-of-the-art machine translation in linear time.",
      }),
    ref("f7000000-0000-4000-8000-000000000035", 35, "35",
      "Wu, Y., et al. Google's neural machine translation system. arXiv, 2016.",
      "unresolved"),
  ];

  const contexts: CitationContext[] = [
    {
      id: "f8000000-0000-4000-8000-000000000001",
      referenceId: references[0].id,
      pageIndex: 0,
      markerText: "[2]",
      sentence:
        "In all but a few cases, however, such attention mechanisms are used in conjunction with a recurrent network [2].",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000002",
      referenceId: references[2].id,
      pageIndex: 0,
      markerText: "[16]",
      sentence:
        "Numerous efforts have pushed the boundaries of recurrent language models and encoder-decoder architectures [16].",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000003",
      referenceId: references[2].id,
      pageIndex: 1,
      markerText: "[16]",
      sentence:
        "The foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [17] use convolutional networks in parallel.",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000004",
      referenceId: references[4].id,
      pageIndex: 1,
      markerText: "[18]",
      sentence:
        "The foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [17] use convolutional networks in parallel.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000005",
      referenceId: references[3].id,
      pageIndex: 1,
      markerText: "[17]",
      sentence:
        "The foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [17] use convolutional networks in parallel.",
      paragraph: null,
      rects: [],
      detectionMethod: "pdf_link",
    },
    {
      id: "f8000000-0000-4000-8000-000000000006",
      referenceId: references[1].id,
      pageIndex: 1,
      markerText: "[4]",
      sentence:
        "Self-attention has been used successfully in a variety of tasks [4].",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000007",
      referenceId: references[0].id,
      pageIndex: 2,
      markerText: "[2]",
      sentence:
        "Individual attention heads clearly learn to perform different tasks, exhibiting behaviour resembling the alignment model of [2].",
      paragraph: null,
      rects: [],
      detectionMethod: "regex",
    },
    {
      id: "f8000000-0000-4000-8000-000000000008",
      referenceId: references[5].id,
      pageIndex: 2,
      markerText: "[35]",
      sentence:
        "Our baselines are the published convolutional and attention models, including GNMT [35].",
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
        paperTitle: "Attention Is All You Need",
        reviewId: "f6000000-0000-4000-8000-000000000001",
        tldr: "Foundational transformer paper; the self-attention-only architecture and BLEU results held up.",
      },
      {
        type: "comment_created",
        at: iso(60 * 8),
        actor: KATHERINE,
        paperId: P1,
        paperTitle: "Attention Is All You Need",
        annotationId: "f5000000-0000-4000-8000-000000000002",
        commentId: "f3000000-0000-4000-8000-000000000021",
        excerpt: "ConvS2S [17] is the baseline to beat here -- check the BLEU table…",
      },
      {
        type: "annotation_created",
        at: iso(60 * 26),
        actor: ALAN,
        paperId: P1,
        paperTitle: "Attention Is All You Need",
        annotationId: "f5000000-0000-4000-8000-000000000001",
        quote: "dispensing with recurrence and convolutions entirely.",
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
