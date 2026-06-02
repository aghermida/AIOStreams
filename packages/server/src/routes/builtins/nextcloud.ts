import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon, createLogger, config as appConfig } from '@aiostreams/core';
import path from 'path';

const router: Router = Router();
const logger = createLogger('server');

/**
 * Resolve and validate the mediaPath from the query string.
 * Returns null (and sends 400/503) if the path is missing or outside the base directory.
 */
function resolveMediaPath(req: Request, res: Response): string | null {
  const rawPath = typeof req.query.mediaPath === 'string' ? req.query.mediaPath : '';
  if (!rawPath) {
    res.status(400).json({ error: 'mediaPath query parameter is required' });
    return null;
  }

  const basePath = appConfig.builtins.nextcloud?.mediaPath;
  if (!basePath) {
    res.status(503).json({ error: 'Nextcloud media path not configured on server' });
    return null;
  }

  // Normalise both paths and ensure the requested path is within the base
  const resolved = path.resolve(rawPath);
  const resolvedBase = path.resolve(basePath);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    logger.warn(`Nextcloud: rejected mediaPath outside base dir: ${rawPath}`);
    res.status(403).json({ error: 'mediaPath is outside the allowed base directory' });
    return null;
  }

  return resolved;
}

router.get(
  '/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(NextcloudAddon.getManifest());
    } catch (error) {
      next(error);
    }
  }
);

interface NextcloudMetaParams {
  type: string;
  id: string;
}

router.get(
  '/meta/:type/:id.json',
  async (
    req: Request<NextcloudMetaParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { type, id } = req.params;
    const mediaPath = resolveMediaPath(req, res);
    if (!mediaPath) return;
    try {
      const addon = new NextcloudAddon(mediaPath);
      const meta = await addon.getMeta(type, id);
      res.json({ meta });
    } catch (error) {
      next(error);
    }
  }
);

interface NextcloudCatalogParams {
  type: string;
  id: string;
  extras?: string;
}

router.get(
  '/catalog/:type/:id{/:extras}.json',
  async (
    req: Request<NextcloudCatalogParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { type, id, extras } = req.params;
    const mediaPath = resolveMediaPath(req, res);
    if (!mediaPath) return;
    try {
      const addon = new NextcloudAddon(mediaPath);
      const catalog = await addon.getCatalog(type, id, extras);
      res.json({ metas: catalog });
    } catch (error) {
      next(error);
    }
  }
);

interface NextcloudStreamParams {
  type: string;
  id: string;
}

router.get(
  '/stream/:type/:id.json',
  async (
    req: Request<NextcloudStreamParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { type, id } = req.params;
    const mediaPath = resolveMediaPath(req, res);
    if (!mediaPath) return;
    try {
      const addon = new NextcloudAddon(mediaPath);
      const streams = await addon.getStreams(type, id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
