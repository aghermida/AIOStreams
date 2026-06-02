import { baseOptions, Preset } from './preset.js';
import { appConfig, constants } from '../utils/index.js';
import {
  PresetMetadata,
  Option,
  Addon,
  UserData,
} from '../db/index.js';
import { StreamParser } from '../parser/index.js';

export class NextcloudPreset extends Preset {
  static override getParser(): typeof StreamParser {
    return StreamParser;
  }

  static override get METADATA(): PresetMetadata {
    const supportedResources = [
      constants.STREAM_RESOURCE,
      constants.CATALOG_RESOURCE,
      constants.META_RESOURCE,
    ];

    const options: Option[] = [
      {
        id: 'url',
        name: 'Nextcloud URL',
        description: 'URL of your Nextcloud instance (e.g. https://cloud.example.com)',
        type: 'url',
        required: true,
        default: '',
        showInSimpleMode: true,
      },
      {
        id: 'username',
        name: 'Username',
        description: 'Your Nextcloud username',
        type: 'string',
        required: true,
        default: '',
        showInSimpleMode: true,
      },
      {
        id: 'password',
        name: 'Password / App Token',
        description:
          'Your Nextcloud password or an app-specific token (recommended: Settings → Security → App passwords).',
        type: 'password',
        required: true,
        default: '',
        showInSimpleMode: true,
      },
      {
        id: 'folder',
        name: 'Folder',
        description:
          'Path to your media folder inside Nextcloud (e.g. /Stremio)',
        type: 'string',
        required: true,
        default: '/Stremio',
        showInSimpleMode: true,
      },
      ...baseOptions(
        'Nextcloud Media',
        supportedResources,
        appConfig.presets.defaultTimeout
      ).filter((o) => o.id !== 'url'),
    ];

    return {
      ID: 'nextcloud-media',
      NAME: 'Nextcloud Media',
      DESCRIPTION:
        'Stream media files from your Nextcloud folder directly in Stremio!',
      LOGO: `/assets/nextcloud_logo.svg`,
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/nextcloud`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_SERVICES: [],
      OPTIONS: options,
      BUILTIN: true,
    };
  }

  static override async generateAddons(
    userData: UserData,
    options: Record<string, any>
  ): Promise<Addon[]> {
    return [this.generateAddon(userData, options)];
  }

  private static generateAddon(
    userData: UserData,
    options: Record<string, any>
  ): Addon {
    return {
      name: options.name || this.METADATA.NAME,
      manifestUrl: this.generateManifestUrl(options),
      enabled: true,
      resources: options.resources || this.METADATA.SUPPORTED_RESOURCES,
      timeout: options.timeout || this.METADATA.TIMEOUT,
      preset: {
        id: '',
        type: this.METADATA.ID,
        options,
      },
      headers: {
        'User-Agent': this.METADATA.USER_AGENT,
      },
    };
  }

  private static generateManifestUrl(options: Record<string, any>): string {
    const config = {
      url: options.url || '',
      username: options.username || '',
      password: options.password || '',
      folder: options.folder || '/Stremio',
    };
    const encoded = Buffer.from(JSON.stringify(config)).toString('base64url');
    return `${this.DEFAULT_URL}/${encoded}/manifest.json`;
  }
}
