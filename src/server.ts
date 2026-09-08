import express, {
  NextFunction,
  Request,
  Response,
} from 'express';
import { config } from './config';
import { openDb, AppDb } from './db';
import {
  authenticateApiRequest,
  claimReplay,
} from './apiAuth';
import { createApiRateLimiter } from './apiRateLimit';
import {
  REGISTRATION_PATH,
  registerPendingClient,
} from './apiRegistration';
import { checkPullGate, attemptPull } from './queue';
import { loadCachedCorpus } from './corpus';
import { validateSlackRequest } from './slack';
import { logHttpRequest } from './requestTelemetry';

export const API_PATH = '/api/generate';

function jsonError(res: Response, status: number, error: string) {
  res.set('cache-control', 'no-store');
  return res.status(status).json({ error });
}

function jsonText(res: Response, text: string) {
  res.set('cache-control', 'no-store');
  return res.status(200).json({ text });
}

function slackResponse(
  res: Response,
  text: string,
  responseType: 'in_channel' | 'ephemeral',
) {
  return res.status(200).json({ response_type: responseType, text });
}

function createReplayGuard() {
  const seen = new Map<string, number>();
  const ttlMs = 5 * 60 * 1000;
  return (signature: string, nowMs = Date.now()): boolean => {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    if (seen.has(signature)) return true;
    seen.set(signature, nowMs + ttlMs);
    return false;
  };
}

export function createApp(options: { db?: AppDb } = {}) {
  const app = express();
  let db = options.db;
  const slackReplay = createReplayGuard();
  const apiRateLimit = createApiRateLimiter(config.apiClientRateLimitPerMinute);

  const getDb = () => {
    if (!db) db = openDb();
    return db;
  };

  app.disable('x-powered-by');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.once('finish', () => {
      try {
        logHttpRequest({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          clientKeyId:
            typeof res.locals.clientKeyId === 'string'
              ? res.locals.clientKeyId
              : undefined,
          authResult:
            typeof res.locals.authResult === 'string'
              ? res.locals.authResult
              : undefined,
          requestBytes: Buffer.isBuffer(req.body) ? req.body.length : undefined,
        });
      } catch {
        // Telemetry must never change request behavior.
      }
    });
    next();
  });

  app.use(
    express.raw({
      type: '*/*',
      limit: config.maxRequestBytes,
    }),
  );

  app.get('/healthz', (_req: Request, res: Response) => res.status(200).type('text/plain').send('ok'));

  app.all('/slack/', (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      return slackResponse(res, 'WRONG_METHOD', 'ephemeral');
    }
    if (!Buffer.isBuffer(req.body)) {
      return slackResponse(res, 'MALFORMED_BODY', 'ephemeral');
    }

    const validation = validateSlackRequest(
      req.body,
      req.get('content-type') ?? undefined,
      req.get('x-slack-request-timestamp') ?? undefined,
      req.get('x-slack-signature') ?? undefined,
    );
    if (validation.kind === 'invalid') {
      return slackResponse(res, validation.code, 'ephemeral');
    }

    const signature = req.get('x-slack-signature');
    if (!signature || slackReplay(signature)) {
      return slackResponse(res, 'REPLAY_REJECTED', 'ephemeral');
    }

    try {
      const database = getDb();
      const gate = checkPullGate(database);
      if (gate.kind !== 'eligible') {
        return slackResponse(res, gate.text, 'ephemeral');
      }
      const corpus = loadCachedCorpus();
      const result = attemptPull(database, corpus);
      if (result.kind === 'served') {
        return slackResponse(res, result.text, 'in_channel');
      }
      if (result.kind === 'blocked') {
        return slackResponse(res, result.text, 'ephemeral');
      }
      return slackResponse(res, 'NO_AVAILABLE_CANDIDATE', 'ephemeral');
    } catch {
      return slackResponse(res, 'SERVICE_UNAVAILABLE', 'ephemeral');
    }
  });

  app.all(REGISTRATION_PATH, (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.set('allow', 'POST');
      return jsonError(res, 405, 'wrong_method');
    }
    if (req.path !== REGISTRATION_PATH || req.originalUrl !== REGISTRATION_PATH) {
      return jsonError(res, 400, 'bad_request');
    }
    if (!Buffer.isBuffer(req.body)) return jsonError(res, 400, 'bad_request');

    try {
      const result = registerPendingClient(getDb(), {
        rawBody: req.body,
        contentType: req.get('content-type') ?? undefined,
        keyIdHeader: req.get('x-genai-key-id') ?? undefined,
        timestampHeader: req.get('x-genai-timestamp') ?? undefined,
        nonceHeader: req.get('x-genai-nonce') ?? undefined,
        signatureHeader: req.get('x-genai-signature') ?? undefined,
        method: req.method,
        path: req.path,
      });
      return res.status(202).json({
        key_id: result.keyId,
        status: result.status,
        fingerprint: result.fingerprint,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'unavailable';
      if (code === 'registration_conflict') return jsonError(res, 409, code);
      if (code === 'unauthorized') return jsonError(res, 401, code);
      if (code === 'bad_request') return jsonError(res, 400, code);
      return jsonError(res, 503, 'unavailable');
    }
  });

  app.all(API_PATH, (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.set('allow', 'POST');
      return jsonError(res, 405, 'wrong_method');
    }
    if (req.path !== API_PATH || req.originalUrl !== API_PATH) {
      return jsonError(res, 400, 'bad_request');
    }
    if (!Buffer.isBuffer(req.body)) return jsonError(res, 400, 'bad_request');

    try {
      const database = getDb();
      const authentication = authenticateApiRequest(database, {
        rawBody: req.body,
        contentType: req.get('content-type') ?? undefined,
        keyIdHeader: req.get('x-genai-key-id') ?? undefined,
        timestampHeader: req.get('x-genai-timestamp') ?? undefined,
        nonceHeader: req.get('x-genai-nonce') ?? undefined,
        signatureHeader: req.get('x-genai-signature') ?? undefined,
        method: req.method,
        path: req.path,
      });

      if (authentication.kind === 'invalid') {
        res.locals.authResult = authentication.authResult;
        if (authentication.status === 401) {
          res.set('x-genai-registration', REGISTRATION_PATH);
        }
        return jsonError(res, authentication.status, authentication.error);
      }

      res.locals.clientKeyId = authentication.keyId;
      res.locals.authResult = 'authenticated';

      const requestLimit = apiRateLimit(authentication.keyId);
      if (!requestLimit.allowed) {
        res.set('retry-after', String(requestLimit.retryAfterSeconds));
        return jsonError(res, 429, 'rate_limited');
      }

      if (claimReplay(database, authentication).kind === 'replay') {
        return jsonError(res, 409, 'replay');
      }

      const optionsForPull = { clientKeyId: authentication.keyId };
      const gate = checkPullGate(database, optionsForPull);
      if (gate.kind !== 'eligible') return jsonText(res, gate.text);

      const corpus = loadCachedCorpus();
      const result = attemptPull(database, corpus, optionsForPull);
      if (result.kind === 'served') return jsonText(res, result.text);
      if (result.kind === 'blocked') return jsonText(res, result.text);
      return jsonText(res, 'NO_AVAILABLE_CANDIDATE');
    } catch {
      return jsonError(res, 503, 'unavailable');
    }
  });

  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        (error as { type?: unknown }).type === 'entity.too.large'
      ) {
        return jsonError(res, 413, 'request_too_large');
      }
      return jsonError(res, 500, 'internal_error');
    },
  );

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(config.port, config.host, () => {
    process.stderr.write(
      `human-centered-genai-reference listening on ${config.host}:${config.port}\n`,
    );
  });
}
