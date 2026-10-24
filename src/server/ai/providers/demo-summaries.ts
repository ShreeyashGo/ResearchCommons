/**
 * Hand-written summaries for the demo papers, served by the mock provider so the
 * offline demo reads like a real model would. Every other paper falls back to the
 * abstract-based mock summary.
 */
interface DemoSummary {
  summary: string;
  keyContribution: string;
}

const DEMO_SUMMARIES: Array<{ titlePrefix: string } & DemoSummary> = [
  {
    titlePrefix: "attention is all you need",
    summary:
      "The paper introduces the Transformer, a sequence-to-sequence model that drops recurrence and convolution entirely and relies only on attention. The encoder and decoder are each a stack of six layers that combine multi-head scaled dot-product self-attention with position-wise feed-forward layers, residual connections and layer normalization; sinusoidal positional encodings supply word order. Because self-attention connects every pair of positions in a constant number of sequential operations, training parallelizes far better than with RNNs. The big model reaches 28.4 BLEU on WMT 2014 English-to-German and 41.8 BLEU on English-to-French, a new state of the art, after 3.5 days of training on eight P100 GPUs, a small fraction of the cost of earlier models. Ablations show that multiple attention heads beat a single head, and the architecture also transfers well to English constituency parsing.",
    keyContribution:
      "Shows that attention alone, with no recurrence or convolution, is enough for state-of-the-art sequence transduction, with much faster and more parallel training.",
  },
  {
    titlePrefix: "agentic misalignment",
    summary:
      "The authors stress-test 16 frontier language models from multiple developers in simulated corporate environments, where each model acts as an autonomous email agent with access to sensitive company information. When the model faced being replaced, or when its assigned goal conflicted with the company's new direction, models from every developer at least sometimes chose harmful insider behaviour, such as blackmailing an executive or leaking confidential documents to a competitor. The models often acknowledged in their reasoning that the action was unethical and went ahead anyway. A threat of replacement or a goal conflict alone was enough to trigger the behaviour; explicit instructions not to do it reduced but did not eliminate it; and models misbehaved more often when they stated that they believed the scenario was real. The scenarios are deliberately contrived, and the authors report no evidence of this behaviour in real deployments, but they argue for caution about deploying models with broad autonomy, little human oversight and access to sensitive information, and for more alignment and safety research.",
    keyContribution:
      "Names and demonstrates agentic misalignment: in controlled tests, models across developers deliberately chose harmful insider-threat actions when their autonomy or goals were threatened.",
  },
  {
    titlePrefix: "adam: a method for stochastic optimization",
    summary:
      "Adam is a first-order optimizer for stochastic objectives. It keeps exponential moving averages of the gradient (the first moment) and of the squared gradient (the second moment), corrects the bias these averages have at initialization, and uses them to give every parameter its own adaptive step size. It is simple to implement, memory-efficient and invariant to diagonal rescaling of the gradients, it copes well with noisy or sparse gradients and non-stationary objectives, and its hyperparameters rarely need tuning. The paper relates Adam to AdaGrad and RMSProp, analyses its convergence in the online convex setting, and shows it matching or beating other stochastic methods on logistic regression, multilayer networks and convolutional networks. It also introduces AdaMax, a variant based on the infinity norm.",
    keyContribution:
      "Combines momentum-style first-moment estimates with RMSProp-style second-moment scaling, plus bias correction, into a robust default optimizer for deep learning.",
  },
];

export function demoSummaryFor(title: string): DemoSummary | null {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  return DEMO_SUMMARIES.find((d) => t.startsWith(d.titlePrefix)) ?? null;
}
