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

    const options: Option[] = (
      appConfig.builtins.nextcloud?.mediaPath
        ? baseOptions(
            'Nextcloud Media',
            supportedResources,
            appConfig.presets.defaultTimeout
          ).filter((o) => o.id !== 'url')
        : []
    );

    return {
      ID: 'nextcloud-media',
      NAME: 'Nextcloud Media',
      DESCRIPTION:
        'Stream media files from your Nextcloud Stremio folder directly in Stremio!',
      LOGO: `/assets/nextcloud_logo.svg`,
      URL: [`${appConfig.bootstrap.internalUrl}/builtins/nextcloud`],
      TIMEOUT: appConfig.presets.defaultTimeout,
      USER_AGENT: appConfig.http.defaultUserAgent,
      SUPPORTED_RESOURCES: supportedResources,
      SUPPORTED_STREAM_TYPES: [constants.HTTP_STREAM_TYPE],
      SUPPORTED_SERVICES: [],
      OPTIONS: options,
      BUILTIN: true,
      DISABLED: !appConfig.builtins.nextcloud?.mediaPath
        ? {
            reason:
              'Not configured. **Admins:** set the Media Path in [Settings → Built-ins](/dashboard/settings?tab=builtins).',
            disabled: true,
          }
        : undefined,
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
    return `${this.DEFAULT_URL}/manifest.json`;
  }
}
