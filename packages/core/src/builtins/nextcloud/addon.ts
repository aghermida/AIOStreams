import { createHmac } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { createLogger, ExtrasParser } from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import { IMDBMetadata } from '../../metadata/imdb.js';
import { IdParser } from '../../utils/id-parser.js';
import { formatBytes } from '../../formatters/index.js';

const logger = createLogger('nextcloud');

const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.m4v',
  '.webm',
  '.flv',
  '.ts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.iso',
]);

const MIME_TYPES: Record<string, string> = {
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.iso': 'application/octet-stream',
};

export function getNextcloudMediaToken(): string {
  return createHmac('sha256', appConfig.bootstrap.internalSecret)
    .update('nextcloud-media-v1')
    .digest('hex')
    .slice(0, 32);
}

export function validateNextcloudMediaToken(token: string): boolean {
  return token === getNextcloudMediaToken();
}

export function getNextcloudMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? 'video/mp4';
}

export class NextcloudAddon {
  private mediaPath: string;

  constructor() {
    const mediaPath = appConfig.builtins.nextcloud?.mediaPath;
    if (!mediaPath) throw new Error('Nextcloud media path is not configured');
    this.mediaPath = mediaPath;
  }

  private getStreamUrl(filename: string): string {
    const token = getNextcloudMediaToken();
    const encoded = encodeURIComponent(filename);
    return `${appConfig.bootstrap.baseUrl}/nextcloud-media/${token}/files/${encoded}`;
  }

  private listVideoFiles(): string[] {
    try {
      const files = readdirSync(this.mediaPath);
      return files.filter((f) => VIDEO_EXTENSIONS.has(extname(f).toLowerCase()));
    } catch (e) {
      logger.error(
        `Failed to read media directory "${this.mediaPath}": ${e instanceof Error ? e.message : e}`
      );
      return [];
    }
  }

  private getFileStat(filename: string) {
    try {
      return statSync(join(this.mediaPath, filename));
    } catch {
      return null;
    }
  }

  private filenameToId(filename: string): string {
    return `nextcloud.${Buffer.from(filename).toString('base64url')}`;
  }

  private idToFilename(id: string): string | null {
    if (!id.startsWith('nextcloud.')) return null;
    const encoded = id.slice('nextcloud.'.length);
    try {
      return Buffer.from(encoded, 'base64url').toString();
    } catch {
      return null;
    }
  }

  static getManifest(): Manifest {
    return {
      id: 'com.nextcloud.aiostreams',
      version: '1.0.0',
      name: 'Nextcloud Media',
      description: 'Stream media files from your Nextcloud Stremio folder!',
      catalogs: [
        {
          name: 'Nextcloud Media',
          id: 'nextcloud.videos',
          type: 'movie',
          extra: [
            { name: 'search', isRequired: false },
            { name: 'skip' },
          ],
        },
      ],
      resources: [
        {
          name: 'stream',
          types: ['movie', 'series'],
          idPrefixes: ['tt'],
        },
        {
          name: 'catalog',
          types: ['movie'],
          idPrefixes: ['nextcloud'],
        },
        {
          name: 'meta',
          types: ['movie'],
          idPrefixes: ['nextcloud'],
        },
      ],
      types: ['movie', 'series'],
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: false,
        configurationRequired: false,
      },
    };
  }

  getManifest(): Manifest {
    return NextcloudAddon.getManifest();
  }

  async getStreams(type: string, id: string): Promise<Stream[]> {
    const parsedId = IdParser.parse(id, type);
    if (!parsedId) throw new Error(`Invalid ID: ${id}`);

    if (parsedId.type !== 'imdbId') {
      logger.debug(`Unsupported ID type for Nextcloud: ${parsedId.type}`);
      return [];
    }

    const { season, episode } = parsedId;
    const seasonNum = season !== undefined ? parseInt(season, 10) : undefined;
    const episodeNum = episode !== undefined ? parseInt(episode, 10) : undefined;

    let titles: string[] = [];
    let year: number | undefined;

    try {
      const imdb = new IMDBMetadata();
      const metadata = await imdb.getTitleAndYear(
        parsedId.value.toString(),
        type
      );
      titles = metadata.titles?.map((t) => t.title) ?? [metadata.title];
      year = metadata.year;
      logger.debug(
        `Metadata for ${id}: titles=${titles.join(', ')}, year=${year}`
      );
    } catch (e) {
      logger.warn(
        `Failed to get metadata for ${id}: ${e instanceof Error ? e.message : e}`
      );
      return [];
    }

    if (titles.length === 0) return [];

    const files = this.listVideoFiles();
    const matches = files.filter((f) =>
      fileMatchesContent(f, titles, year, seasonNum, episodeNum)
    );

    logger.debug(
      `Found ${matches.length} file(s) for ${id}: ${matches.join(', ')}`
    );

    return matches.map((filename) => {
      const stat = this.getFileStat(filename);
      return {
        name: 'Nextcloud',
        description: filename,
        url: this.getStreamUrl(filename),
        behaviorHints: {
          filename,
          videoSize: stat?.size,
          notWebReady: false,
        },
      };
    });
  }

  async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<MetaPreview[]> {
    if (id !== 'nextcloud.videos' || type !== 'movie') {
      throw new Error('Unsupported catalog type or ID');
    }
    const parsedExtras = extras ? new ExtrasParser(extras) : undefined;
    const search = parsedExtras?.search?.toLowerCase();
    const skip = parsedExtras?.skip ?? 0;

    let files = this.listVideoFiles();
    if (search) {
      files = files.filter((f) => f.toLowerCase().includes(search));
    }

    return files.slice(skip, skip + 100).map((filename) => {
      const stat = this.getFileStat(filename);
      return this.createMetaPreview(filename, stat?.size);
    });
  }

  async getMeta(type: string, id: string): Promise<Meta> {
    if (type !== 'movie' || !id.startsWith('nextcloud.')) {
      throw new Error('Unsupported type or ID for Meta request');
    }

    const filename = this.idToFilename(id);
    if (!filename) throw new Error('Invalid Nextcloud meta ID');

    const stat = this.getFileStat(filename);
    if (!stat) throw new Error(`File not found: ${filename}`);

    const streamUrl = this.getStreamUrl(filename);
    const cleanName = cleanFilename(filename);

    return {
      id,
      name: cleanName,
      description: `📦 ${formatBytes(stat.size, 1000)} • 📅 ${stat.mtime.toLocaleDateString()}`,
      type: 'movie',
      posterShape: 'landscape',
      videos: [
        {
          id: filename,
          title: filename,
          released: stat.mtime.toISOString(),
          streams: [
            {
              name: 'Nextcloud',
              description: filename,
              url: streamUrl,
              behaviorHints: {
                filename,
                videoSize: stat.size,
                notWebReady: false,
              },
            },
          ],
        },
      ],
    };
  }

  private createMetaPreview(filename: string, size?: number): MetaPreview {
    const cleanName = cleanFilename(filename);
    return {
      id: this.filenameToId(filename),
      name: cleanName,
      description: size ? formatBytes(size, 1000) : undefined,
      type: 'movie',
    };
  }
}

/** Strip extension and quality tags, replace dots/underscores with spaces */
function cleanFilename(filename: string): string {
  // Remove extension
  const base = filename.replace(/\.[^.]+$/, '');
  // Replace dots and underscores with spaces
  const spaced = base.replace(/[._]/g, ' ');
  // Remove common quality/source tags and everything after
  return spaced
    .replace(
      /\s*(1080p|720p|480p|2160p|4K|UHD|BluRay|BDRip|WEBRip|WEB-DL|HDRip|HDTV|DVDRip|x264|x265|HEVC|H\.264|H\.265|AAC|DTS|DD5|AC3|Remux|PROPER|REPACK).*$/i,
      ''
    )
    .trim();
}

/** Check if a filename matches the requested content */
function fileMatchesContent(
  filename: string,
  titles: string[],
  year?: number,
  season?: number,
  episode?: number
): boolean {
  const lower = filename.toLowerCase();
  // Normalise filename: replace separators, remove non-alphanumeric
  const normalized = lower.replace(/[._\-]/g, ' ');

  // Check title match (normalise titles the same way)
  const normalizedTitles = titles.map((t) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
  );
  const normalizedFile = normalized.replace(/[^a-z0-9\s]/g, '');

  const titleMatch = normalizedTitles.some((title) => {
    if (!title) return false;
    return normalizedFile.includes(title);
  });

  if (!titleMatch) return false;

  // Series: require season + episode match
  if (season !== undefined && episode !== undefined) {
    const sPad = season.toString().padStart(2, '0');
    const ePad = episode.toString().padStart(2, '0');
    const patterns = [
      `s${sPad}e${ePad}`,
      `s${season}e${episode}`,
      `${season}x${ePad}`,
      `season ${season} episode ${episode}`,
    ];
    return patterns.some((p) => lower.includes(p));
  }

  // Movie: verify year if both sides have one
  if (year) {
    const yearMatch = filename.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return Math.abs(parseInt(yearMatch[0], 10) - year) <= 1;
    }
  }

  return true;
}
