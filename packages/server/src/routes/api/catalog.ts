import { Router, Request, Response, NextFunction } from 'express';
import { createResponse } from '../../utils/responses.js';
import { catalogApiRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession, injectAccessKey } from '../../middlewares/auth.js';
import { parseBasicAuthHeader } from '../../utils/basic-auth.js';
import {
  createLogger,
  UserData,
  AIOStreams,
  UserDataSchema,
  validateConfig,
  APIError,
  constants,
  UserRepository,
  mergeConfigs,
} from '@aiostreams/core';

const router: Router = Router();

const logger = createLogger('server');
router.use(catalogApiRateLimiter);
router.use(attachSession);

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const { userData } = req.body;
  try {
    let validatedUserData: UserData;

    let configToValidate: UserData = userData;
    if (userData.parentConfig?.uuid) {
      let parent: UserData;
      try {
        const rawParent = await UserRepository.getRawUser(
          userData.parentConfig.uuid,
          userData.parentConfig.password
        );
        if (!rawParent) throw new Error('Parent config not found');
        parent = rawParent;
      } catch (error) {
        return Promise.reject(
          new APIError(
            constants.ErrorCode.PARENT_CONFIG_UNAVAILABLE,
            undefined,
            error instanceof APIError ? error.message : String(error)
          )
        );
      }
      const merged = mergeConfigs(parent, userData);
      merged.trusted = parent.trusted || userData.trusted;
      configToValidate = merged;
    }

    // Session-independent path: a caller presenting valid uuid+password for
    // this exact config (e.g. an admin-provisioned user editing their own
    // profile with no site session) is owner-verified without needing
    // req.user, mirroring the PUT /api/v1/user save gate.
    let ownerVerified = false;
    if (!req.user) {
      try {
        const creds = parseBasicAuthHeader(req, { allowEncrypted: false });
        if (creds) {
          await UserRepository.verifyUser(creds.uuid, creds.password);
          ownerVerified = true;
        }
      } catch {
        // No/invalid credentials - fall through, ownerVerified stays false.
      }
    }
    injectAccessKey(req, configToValidate, ownerVerified);

    try {
      validatedUserData = await validateConfig(configToValidate, {
        skipErrorsFromAddonsOrProxies: false,
        decryptValues: true,
        increasedManifestTimeout: true,
        bypassManifestCache: true,
      });
    } catch (error) {
      if (
        error instanceof APIError &&
        error.code === constants.ErrorCode.ADDON_PASSWORD_INVALID
      ) {
        next(
          new APIError(
            constants.ErrorCode.ADDON_PASSWORD_INVALID,
            undefined,
            'Please make sure the addon password is provided and correct by attempting to create/save a user first'
          )
        );
        return;
      }
      next(
        new APIError(
          constants.ErrorCode.USER_INVALID_CONFIG,
          undefined,
          error instanceof Error ? error.message : undefined
        )
      );
      return;
    }
    validatedUserData.catalogModifications = undefined;

    const aio = new AIOStreams(validatedUserData);
    await aio.initialise();
    // return minimal catalog data
    const catalogs = aio.getCatalogs().map((catalog) => ({
      id: catalog.id,
      name: catalog.name,
      type: catalog.type,
      addonName: aio.getAddon(catalog.id.split('.')[0])?.name,

      hideable: catalog.extra
        ? catalog.extra.every((e) => !e.isRequired)
        : true,
      searchable: catalog.extra
        ? catalog.extra?.findIndex(
            (e) => e.name === 'search' && !e.isRequired
          ) !== -1
        : false,
    }));
    res.status(200).json(createResponse({ success: true, data: catalogs }));
  } catch (error) {
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
});

export default router;
