import express, { Request, Response, Express } from 'express';
import {
  userApi,
  healthApi,
  statusApi,
  formatApi,
  catalogApi,
  postersApi,
  gdriveApi,
  debridApi,
  searchApi,
  animeApi,
  proxyApi,
  templatesApi,
  syncApi,
  authApi,
  dashboardApi,
} from './routes/api/index.js';
import {
  configure,
  manifest,
  stream,
  catalog,
  meta,
  subtitle,
  addonCatalog,
  alias,
} from './routes/stremio/index.js';
import {
  manifest as chillLinkManifest,
  streams as chillLinkStreams,
} from './routes/chilllink/index.js';
import seanimeExtensionsRouter from './routes/seanime/extensions.js';
import {
  gdrive,
  torboxSearch,
  torznab,
  newznab,
  prowlarr,
  knaben,
  eztv,
  torrentGalaxy,
  seadex,
  easynews,
  library,
  nextcloud,
} from './routes/builtins/index.js';
import {
  ipMiddleware,
  loggerMiddleware,
  userDataMiddleware,
  errorMiddleware,
  corsMiddleware,
  staticRateLimiter,
  internalMiddleware,
  stremioStreamRateLimiter,
  requireSessionIfAuthRequired,
} from './middlewares/index.js';

import {
  config as appConfig,
  constants,
  createLogger,
  Env,
  validateNextcloudMediaToken,
  type NextcloudConfig,
} from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';
import { createResponse } from './utils/responses.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const app: Express = express();
const logger = createLogger('server');

export enum StaticFiles {
  DOWNLOAD_FAILED = 'download_failed.mp4',
  DOWNLOADING = 'downloading.mp4',
  UNAVAILABLE_FOR_LEGAL_REASONS = 'unavailable_for_legal_reasons.mp4',
  STORE_LIMIT_EXCEEDED = 'store_limit_exceeded.mp4',
  CONTENT_PROXY_LIMIT_REACHED = 'content_proxy_limit_reached.mp4',
  INTERNAL_SERVER_ERROR = '500.mp4',
  TOO_MANY_REQUESTS = '429.mp4',
  FORBIDDEN = '403.mp4',
  UNAUTHORIZED = '401.mp4',
  NO_MATCHING_FILE = 'no_matching_file.mp4',
  PAYMENT_REQUIRED = 'payment_required.mp4',
  OK = '200.mp4',
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const frontendRoot = path.join(__dirname, '../../frontend/dist');
export const staticRoot = path.join(__dirname, './static');

app.use(ipMiddleware);
app.use(loggerMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow all origins in development for easier testing
if (appConfig.bootstrap.nodeEnv === 'development') {
  logger.info('CORS enabled for all origins in development');
  app.use(corsMiddleware);
}

// API Routes
const apiRouter = express.Router();
apiRouter.use('/user', userApi);
apiRouter.use('/health', healthApi);
apiRouter.use('/status', statusApi);
apiRouter.use('/format', formatApi);
apiRouter.use('/catalogs', catalogApi);
apiRouter.use('/posters', postersApi);
apiRouter.use('/oauth/exchange/gdrive', gdriveApi);
apiRouter.use('/debrid', debridApi);
apiRouter.use(
  '/search',
  (req, res, next) => {
    if (!appConfig.api.enableSearchApi) {
      res.status(403).json({ error: 'Search API is disabled', success: false });
      return;
    }
    next();
  },
  searchApi
);
apiRouter.use('/anime', animeApi);
apiRouter.use('/proxy', proxyApi);
apiRouter.use('/templates', templatesApi);
apiRouter.use('/sync', syncApi);
apiRouter.use('/auth', authApi);
apiRouter.use('/dashboard', dashboardApi);
apiRouter.use((req, res) => {
  res.status(404).json(
    createResponse({
      success: false,
      detail: 'Not Found',
    })
  );
});

app.use(`/api/v${constants.API_VERSION}`, apiRouter);

// Stremio Routes
const stremioRouter = express.Router({ mergeParams: true });
stremioRouter.use(corsMiddleware);
// Public routes - no auth needed
stremioRouter.use('/manifest.json', manifest);
stremioRouter.use('/stream', stream);
stremioRouter.use('/configure', requireSessionIfAuthRequired, configure);

stremioRouter.use('/u', alias);

// Protected routes with authentication
const stremioAuthRouter = express.Router({ mergeParams: true });
stremioAuthRouter.use(corsMiddleware);
stremioAuthRouter.use(userDataMiddleware);
stremioAuthRouter.use('/manifest.json', manifest);
stremioAuthRouter.use('/stream', stream);
stremioAuthRouter.use('/configure', requireSessionIfAuthRequired, configure);
stremioAuthRouter.use('/meta', meta);
stremioAuthRouter.use('/catalog', catalog);
stremioAuthRouter.use('/subtitles', subtitle);
stremioAuthRouter.use('/addon_catalog', addonCatalog);

app.use('/stremio', stremioRouter); // For public routes
app.use('/stremio/:uuid/:encryptedPassword', stremioAuthRouter); // For authenticated routes

const chillLinkRouter = express.Router({ mergeParams: true });
chillLinkRouter.use(corsMiddleware);
chillLinkRouter.use(userDataMiddleware);
chillLinkRouter.use('/manifest', chillLinkManifest);
chillLinkRouter.use('/streams', chillLinkStreams);

app.use('/chilllink/:uuid/:encryptedPassword', chillLinkRouter);

const seanimeRouter = express.Router({ mergeParams: true });
seanimeRouter.use(corsMiddleware);
seanimeRouter.use(seanimeExtensionsRouter);

app.use('/seanime', seanimeRouter);

const builtinsRouter = express.Router();
builtinsRouter.use(internalMiddleware);
builtinsRouter.use('/gdrive', gdrive);
builtinsRouter.use('/torbox-search', torboxSearch);
builtinsRouter.use('/torznab', torznab);
builtinsRouter.use('/newznab', newznab);
builtinsRouter.use('/prowlarr', prowlarr);
builtinsRouter.use('/knaben', knaben);
builtinsRouter.use('/eztv', eztv);
builtinsRouter.use('/torrent-galaxy', torrentGalaxy);
builtinsRouter.use('/seadex', seadex);
builtinsRouter.use('/easynews', easynews);
builtinsRouter.use('/library', library);
builtinsRouter.use('/nextcloud', nextcloud);
app.use('/builtins', builtinsRouter);

// Public Nextcloud media file server — WebDAV proxy (token-protected, range-request capable)
// URL: /nextcloud-media/:mediaToken/:base64Config/files/:filename
// base64Config = base64url(JSON({ url, username, password, folder }))
// The HMAC token is derived from the config itself, so it's config-specific.
interface NextcloudMediaParams {
  mediaToken: string;
  base64Config: string;
  filename: string;
}
app.get(
  '/nextcloud-media/:mediaToken/:base64Config/files/:filename',
  async (req: Request<NextcloudMediaParams>, res: Response) => {
    const mediaToken = req.params.mediaToken;
    const base64Config = req.params.base64Config;
    const filename = req.params.filename;

    let config: NextcloudConfig;
    try {
      config = JSON.parse(
        Buffer.from(base64Config, 'base64url').toString()
      ) as NextcloudConfig;
    } catch {
      res.status(400).json({ error: 'Invalid config encoding' });
      return;
    }

    if (!validateNextcloudMediaToken(mediaToken, config)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const decodedFilename = decodeURIComponent(filename as string);
    if (
      decodedFilename.includes('/') ||
      decodedFilename.includes('\\') ||
      decodedFilename.includes('..')
    ) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const davUrl = `${config.url}/remote.php/dav/files/${config.username}${config.folder}/${decodedFilename}`;
    const fetchHeaders: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    };
    if (req.headers.range) fetchHeaders['Range'] = req.headers.range;

    try {
      const davRes = await fetch(davUrl, { headers: fetchHeaders });
      res.status(davRes.status);
      for (const key of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ]) {
        const val = davRes.headers.get(key);
        if (val) res.setHeader(key, val);
      }
      if (davRes.body) {
        const { Readable } = await import('stream');
        Readable.fromWeb(davRes.body as any).pipe(res);
      } else {
        res.end();
      }
    } catch (e) {
      logger.error(
        `Nextcloud proxy error for "${decodedFilename}": ${e instanceof Error ? e.message : e}`
      );
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to fetch from Nextcloud' });
      }
    }
  }
);

// Content-hashed build assets. These filenames change on every content
// change, so they are immutable and safe to cache aggressively. Deliberately
// NOT behind staticRateLimiter: a single page load pulls many of these and
// rate-limiting them is what caused asset fetch failures + the logo flash.
app.get('/assets/*any', (req, res, next) => {
  const filePath = path.resolve(frontendRoot, req.path.replace(/^\//, ''));
  if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
    return;
  }
  next();
});

// Root-level static files (not content-hashed). Short cache; kept behind the
// static rate limiter. The logo honours the alternate-design branding flag.
app.get('/logo.png', staticRateLimiter, (req, res, next) => {
  const filePath = path.resolve(
    frontendRoot,
    appConfig.branding.alternateDesign ? 'logo_alt.png' : 'logo.png'
  );
  if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
    return;
  }
  next();
});
app.get(
  [
    '/favicon.ico',
    '/manifest.json',
    '/web-app-manifest-192x192.png',
    '/web-app-manifest-512x512.png',
    '/apple-icon.png',
    '/mini-nightly-white.png',
    '/mini-stable-white.png',
    '/icon0.svg',
    '/icon1.png',
    '/logo_alt.png',
  ],
  staticRateLimiter,
  (req, res, next) => {
    const filePath = path.resolve(frontendRoot, req.path.replace(/^\//, ''));
    if (filePath.startsWith(frontendRoot) && fs.existsSync(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.sendFile(filePath);
      return;
    }
    next();
  }
);

app.get('/static/*any', corsMiddleware, (req, res, next) => {
  const filePath = path.resolve(
    staticRoot,
    req.path.replace(/^\/static\//, '')
  );
  logger.debug(`Static file requested: ${filePath}`);
  if (filePath.startsWith(staticRoot) && fs.existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  next();
});

// legacy route handlers
app.get(
  '{/:config}/stream/:type/:id.json',
  stremioStreamRateLimiter,
  (req, res) => {
    const baseUrl =
      appConfig.bootstrap.baseUrl ||
      `${req.protocol}://${req.hostname}${
        req.hostname === 'localhost' ? `:${appConfig.bootstrap.port}` : ''
      }`;
    res.json({
      streams: [
        StremioTransformer.createErrorStream({
          errorDescription:
            'AIOStreams v2 requires you to reconfigure. Please click this stream to reconfigure.',
          errorUrl: `${baseUrl}/stremio/configure`,
        }),
      ],
    });
  }
);

// redirect for legacy paths
app.get('{/:config}/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

app.get('/configure', (req, res) => {
  res.redirect('/stremio/configure');
});

// SPA fallback.
app.get('*splat', staticRateLimiter, (req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) {
    next();
    return;
  }
  const indexPath = path.join(frontendRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
    return;
  }
  next();
});

// Error handling middleware should be last
app.use(errorMiddleware);

export default app;
