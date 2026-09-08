# Human-Centered Generative AI Evaluation

## The actual AI problem

The central problem was not text generation itself. It was **quality specification**.

In a narrow creative domain, experts can often tell immediately whether an output works while finding it difficult to express the full decision rule in advance. A generic prompt such as “generate something new in this style” tends to collapse toward obvious imitation, generic model quirks, or surface-level novelty.

The project treated the target aesthetic as a latent function that had to be inferred and operationalized.

## Imperfect preference data

The historical corpus included a ranking signal, but that signal was not suitable as a simple label.

Typical problems with this kind of data include:

- uneven exposure;
- highly ranked items receiving far more comparisons than long-tail items;
- sparse or missing evidence for large portions of the corpus;
- loss of the original pairwise matchup history;
- popularity and exposure effects becoming entangled with quality.

Without raw pairwise outcomes, it is unsafe to reduce the problem to:

```text
high rank = positive example
low rank = negative example
```

Instead, rankings were treated as one imperfect signal among several.

## Reverse-engineering latent quality criteria

The useful work was to inspect strong and weak examples and formalize recurring dimensions that humans appeared to care about.

Examples of generalizable dimensions include:

- cadence and grammatical structure;
- specificity versus genericness;
- compression: how much implied context a short output carries;
- register mismatch and tonal contrast;
- escalation and anticlimax;
- semantic collision;
- structural variety;
- novelty without randomness;
- whether a phrase implies a coherent situation rather than merely combining unusual words;
- whether visible construction machinery harms the final result;
- whether conceptual cleverness actually translates into human satisfaction.

Negative constraints are equally important. Recurrent failure modes included:

- generic “quirky AI” voice;
- random noun swapping;
- obvious templates;
- over-explanation;
- superficial weirdness without an implied situation;
- close imitation of existing examples;
- technically clever constructions that human evaluators still dislike.

These observations were converted into model-usable instructions, exemplar selection, anti-exemplars, novelty boundaries, and evaluation criteria.

## Human-in-the-loop calibration

Model self-evaluation was never treated as ground truth.

The workflow was closer to:

```text
candidate batch
    |
    v
human scoring
    |
    +--> model scoring / critique
    |          |
    |          v
    +---- disagreement analysis
               |
               v
      revised instructions / exemplars
               |
               v
          next candidate batch
```

Disagreements are especially informative. They reveal whether the model understands a general principle but applies it incorrectly at phrase level.

For example, a model might systematically:

- over-penalize visible construction even when humans like the finished result;
- over-reward elegant conceptual structures that humans find inert;
- correctly identify broad stylistic tendencies but mis-rank individual candidates.

That distinction matters because “can explain the style” and “can judge the style” are not the same capability.

## Lightweight evaluation metrics

For ordinal human/model scores, useful descriptive metrics include:

- score distributions;
- mean and median scores;
- exact agreement rate;
- within-one-point agreement;
- confusion tables;
- Pearson or Spearman correlation;
- the specific examples with the largest disagreement.

The repository includes a synthetic utility:

```bash
node scripts/analyze-evaluations.mjs data/evaluation-sample.csv
```

Metrics are diagnostics, not replacements for examining disagreement examples directly.

## Quality and novelty are different objectives

A candidate can be excellent but already exist in the authoritative corpus. It can also be novel but poor.

The architecture therefore keeps these independent:

```text
quality evaluation -> approved candidate
                         |
                         v
                 novelty validation
                         |
                         v
                    production serve
```

The production serving layer uses normalization and an authoritative external-corpus snapshot to reject collisions before delivery.

## Claims and evidence

A defensible professional description is:

> Human-competitive domain-specific generation evaluated by domain-aware human reviewers.

A stronger claim such as “indistinguishable from human-authored output” would require a blinded discrimination study specifically designed to test that hypothesis. This repository does not claim such a study has been performed.

## What is intentionally omitted

The original corpus, domain content, real exemplars, private prompts, and evaluation annotations are not published here. The purpose of this document is to expose the methodology while preserving the private content domain.
