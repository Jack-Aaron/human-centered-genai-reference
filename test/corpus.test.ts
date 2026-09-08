import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import {
  CorpusError,
  extractCorpusEntries,
  loadCachedCorpus,
  refreshCorpusSnapshot,
} from '../src/corpus';
import { normalizeText } from '../src/normalize';

const cleanup: string[] = [];
const original = {
  url: config.externalCorpusUrl,
  path: config.corpusSnapshotPath,
  min: config.corpusMinEntries,
  age: config.corpusMaxAgeSeconds,
};

afterEach(() => {
  config.externalCorpusUrl = original.url;
  config.corpusSnapshotPath = original.path;
  config.corpusMinEntries = original.min;
  config.corpusMaxAgeSeconds = original.age;
  while (cleanup.length) fs.rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe('external corpus validation', () => {
  it('extracts and normalizes table entries', () => {
    const html = `<table><tbody>
      <tr><td>1</td><td>  Example — ONE </td></tr>
      <tr><td>2</td><td>Example TWO</td></tr>
    </tbody></table>`;
    expect(extractCorpusEntries(html)).toEqual([
      normalizeText('Example — ONE'),
      normalizeText('Example TWO'),
    ]);
  });

  it('refreshes a local source and loads a validated cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
    cleanup.push(dir);
    const sourcePath = path.join(dir, 'corpus.html');
    fs.writeFileSync(
      sourcePath,
      '<table><tbody><tr><td>1</td><td>A</td></tr><tr><td>2</td><td>B</td></tr><tr><td>3</td><td>C</td></tr></tbody></table>',
    );
    config.externalCorpusUrl = `file://${sourcePath}`;
    config.corpusSnapshotPath = path.join(dir, 'snapshot.json');
    config.corpusMinEntries = 3;
    config.corpusMaxAgeSeconds = 3600;

    expect(await refreshCorpusSnapshot({ force: true })).toMatchObject({
      kind: 'updated',
      count: 3,
    });
    expect(loadCachedCorpus().size).toBe(3);
  });

  it('fails closed on a stale snapshot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
    cleanup.push(dir);
    config.corpusSnapshotPath = path.join(dir, 'snapshot.json');
    config.corpusMinEntries = 1;
    config.corpusMaxAgeSeconds = 1;
    fs.writeFileSync(
      config.corpusSnapshotPath,
      JSON.stringify({
        generated_at: '2026-09-07T12:00:00.000Z',
        source: 'synthetic',
        entries: ['a'],
      }),
    );

    expect(() =>
      loadCachedCorpus(Date.parse('2026-09-07T12:00:02Z')),
    ).toThrow(CorpusError);
  });
});
