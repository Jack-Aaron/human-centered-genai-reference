#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv[2] ?? './data/evaluation-sample.csv';
const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
const header = lines.shift()?.split(',') ?? [];
const humanIndex = header.indexOf('human_score');
const modelIndex = header.indexOf('model_score');
if (humanIndex < 0 || modelIndex < 0) {
  throw new Error('CSV must contain human_score and model_score columns');
}

const pairs = lines.map((line) => {
  const fields = line.split(',');
  return [Number(fields[humanIndex]), Number(fields[modelIndex])];
});

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const human = pairs.map(([h]) => h);
const model = pairs.map(([, m]) => m);
const humanMean = mean(human);
const modelMean = mean(model);
const covariance = mean(pairs.map(([h, m]) => (h - humanMean) * (m - modelMean)));
const humanSd = Math.sqrt(mean(human.map((v) => (v - humanMean) ** 2)));
const modelSd = Math.sqrt(mean(model.map((v) => (v - modelMean) ** 2)));
const correlation = humanSd && modelSd ? covariance / (humanSd * modelSd) : 0;
const exact = pairs.filter(([h, m]) => h === m).length;
const withinOne = pairs.filter(([h, m]) => Math.abs(h - m) <= 1).length;

console.log(JSON.stringify({
  n: pairs.length,
  human_mean: Number(humanMean.toFixed(3)),
  model_mean: Number(modelMean.toFixed(3)),
  exact_agreement: Number((exact / pairs.length).toFixed(3)),
  within_one_point: Number((withinOne / pairs.length).toFixed(3)),
  pearson_correlation: Number(correlation.toFixed(3)),
}, null, 2));
