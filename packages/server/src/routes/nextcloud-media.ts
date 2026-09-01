import { Router, Request, Response } from 'express';
import {
  createLogger,
  validateNextcloudMediaToken,
  type NextcloudConfig,
} from '@aiostreams/core';

const router: Router = Router();
const logger = createLogger('nextcloud');

// Public Nextcloud media file server — WebDAV proxy (token-protected, range-request capable)
// URL: /nextcloud-media/:mediaToken/:base64Config/files/:filename
// base64Config = base64url(JSON({ url, username, password, folder }))
// The HMAC token is derived from the config itself, so it's config-specific.
interface NextcloudMediaParams {
  mediaToken: string;
  base64Config: string;
  filename: string;
}

router.get(
  '/:mediaToken/:base64Config/files/:filename',
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

export default router;
