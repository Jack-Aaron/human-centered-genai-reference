import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { config } from './config';
import { normalizeText } from './normalize';

export class CorpusError extends Error {}

export interface CorpusSnapshot {
  generated_at: string;
  source: string;
  entries: string[];
}

function parseSnapshot(raw: string): CorpusSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorpusError('Corpus snapshot was not valid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('generated_at' in parsed) ||
    !('source' in parsed) ||
    !('entries' in parsed)
  ) {
    throw new CorpusError('Corpus snapshot had invalid structure');
  }

  const candidate = parsed as {
    generated_at: unknown;
    source: unknown;
    entries: unknown;
  };

  if (
    typeof candidate.generated_at !== 'string' ||
    typeof candidate.source !== 'string' ||
    !Array.isArray(candidate.entries) ||
    !candidate.entries.every((entry) => typeof entry === 'string')
  ) {
    throw new CorpusError('Corpus snapshot had invalid structure');
  }

  if (candidate.entries.length < config.corpusMinEntries) {
    throw new CorpusError(
      `Corpus snapshot contained only ${candidate.entries.length} entries`,
    );
  }

  return {
    generated_at: candidate.generated_at,
    source: candidate.source,
    entries: candidate.entries,
  };
}

function readSnapshotIfPresent(): CorpusSnapshot | undefined {
  if (!fs.existsSync(config.corpusSnapshotPath)) return undefined;
  return parseSnapshot(
    fs.readFileSync(config.corpusSnapshotPath, 'utf8'),
  );
}

function writeSnapshot(snapshot: CorpusSnapshot): void {
  fs.mkdirSync(path.dirname(config.corpusSnapshotPath), { recursive: true });
  const temporary = `${config.corpusSnapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, config.corpusSnapshotPath);
}

async function readSource(): Promise<string> {
  if (config.externalCorpusUrl.startsWith('file://')) {
    const relative = config.externalCorpusUrl.slice('file://'.length);
    const filePath = path.resolve(process.cwd(), relative);
    const stat = fs.statSync(filePath);
    if (stat.size > config.corpusMaxBytes) {
      throw new CorpusError('External corpus exceeded the configured size limit');
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.corpusFetchTimeoutMs,
  );

  try {
    const response = await fetch(config.externalCorpusUrl, {
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'text/html,text/plain;q=0.9' },
    });
    if (!response.ok) {
      throw new CorpusError(`External corpus returned HTTP ${response.status}`);
    }

    const advertisedLength = Number.parseInt(
      response.headers.get('content-length') ?? '0',
      10,
    );
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > config.corpusMaxBytes
    ) {
      throw new CorpusError('External corpus exceeded the configured size limit');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > config.corpusMaxBytes) {
      throw new CorpusError('External corpus exceeded the configured size limit');
    }
    return buffer.toString('utf8');
  } catch (error) {
    if (error instanceof CorpusError) throw error;
    throw new CorpusError('External corpus could not be fetched');
  } finally {
    clearTimeout(timer);
  }
}

export function extractCorpusEntries(input: string): string[] {
  const $ = load(input);
  const values: string[] = [];

  $('[data-corpus-item]').each((_index: number, element: any) => {
    values.push($(element).text());
  });

  $('table tbody tr').each((_index: number, row: any) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      values.push($(cells[1]).text());
    }
  });

  const normalized = values
    .map(normalizeText)
    .filter(Boolean);

  return [...new Set(normalized)];
}

export async function refreshCorpusSnapshot(options: {
  force?: boolean;
  nowMs?: number;
} = {}): Promise<{ kind: 'fresh' | 'updated'; count: number }> {
  const nowMs = options.nowMs ?? Date.now();
  let existing: CorpusSnapshot | undefined;

  try {
    existing = readSnapshotIfPresent();
  } catch (error) {
    if (!options.force) throw error;
    existing = undefined;
  }

  if (!options.force && existing) {
    const ageMs = nowMs - Date.parse(existing.generated_at);
    if (ageMs >= 0 && ageMs <= config.corpusMaxAgeSeconds * 1000) {
      return { kind: 'fresh', count: existing.entries.length };
    }
  }

  const source = await readSource();
  const entries = extractCorpusEntries(source);
  if (entries.length < config.corpusMinEntries) {
    throw new CorpusError(
      `External corpus contained only ${entries.length} usable entries`,
    );
  }

  const snapshot: CorpusSnapshot = {
    generated_at: new Date(nowMs).toISOString(),
    source: config.externalCorpusUrl,
    entries,
  };
  writeSnapshot(snapshot);
  return { kind: 'updated', count: entries.length };
}

export function loadCachedCorpus(nowMs = Date.now()): Set<string> {
  const snapshot = readSnapshotIfPresent();
  if (!snapshot) {
    throw new CorpusError('Corpus snapshot is missing');
  }
  const generatedAt = Date.parse(snapshot.generated_at);
  if (!Number.isFinite(generatedAt)) {
    throw new CorpusError('Corpus snapshot timestamp was invalid');
  }
  const ageMs = nowMs - generatedAt;
  if (ageMs < 0 || ageMs > config.corpusMaxAgeSeconds * 1000) {
    throw new CorpusError('Corpus snapshot is stale');
  }
  return new Set(snapshot.entries);
}
