import { Router, Request, Response, NextFunction } from 'express';
import { NextcloudAddon, NextcloudConfig, createLogger } from '@aiostreams/core';

const router: Router = Router();
const logger = createLogger('server');

function decodeConfig(encoded: string): NextcloudConfig {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString());
}

router.get(
  '{/:encodedConfig}/manifest.json',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = req.params.encodedConfig
        ? decodeConfig(req.params.encodedConfig)
        : undefined;
      const manifest = config
        ? new NextcloudAddon(config).getManifest()
        : NextcloudAddon.getManifest();
      res.json(manifest);
    } catch (error) {
      next(error);
    }
  }
);

interface NextcloudConfigParams {
  encodedConfig: string;
  type: string;
  id: string;
}

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (
    req: Request<NextcloudConfigParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;
    try {
      const config = decodeConfig(encodedConfig);
      const addon = new NextcloudAddon(config);
      const meta = await addon.getMeta(type, id);
      res.json({ meta });
    } catch (error) {
      next(error);
    }
  }
);

interface NextcloudCatalogParams {
  encodedConfig: string;
  type: string;
  id: string;
  extras?: string;
}

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (
    req: Request<NextcloudCatalogParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id, extras } = req.params;
    try {
      const config = decodeConfig(encodedConfig);
      const addon = new NextcloudAddon(config);
      const catalog = await addon.getCatalog(type, id, extras);
      res.json({ metas: catalog });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (
    req: Request<NextcloudConfigParams>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;
    try {
      const config = decodeConfig(encodedConfig);
      const addon = new NextcloudAddon(config);
      const streams = await addon.getStreams(type, id);
      res.json({ streams });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
