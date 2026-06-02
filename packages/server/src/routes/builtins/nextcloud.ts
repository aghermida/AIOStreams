import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon, createLogger } from '@aiostreams/core';

const router: Router = Router();
const logger = createLogger('server');

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
    try {
      const addon = new NextcloudAddon();
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
    try {
      const addon = new NextcloudAddon();
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
    try {
      const addon = new NextcloudAddon();
      const streams = await addon.getStreams(type, id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
