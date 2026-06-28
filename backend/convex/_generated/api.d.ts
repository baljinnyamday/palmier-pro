/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as billing from "../billing.js";
import type * as feedback from "../feedback.js";
import type * as generations from "../generations.js";
import type * as models from "../models.js";
import type * as providers_audio from "../providers/audio.js";
import type * as providers_env from "../providers/env.js";
import type * as providers_fal from "../providers/fal.js";
import type * as providers_image from "../providers/image.js";
import type * as providers_openaiImage from "../providers/openaiImage.js";
import type * as providers_router from "../providers/router.js";
import type * as providers_seedanceVideo from "../providers/seedanceVideo.js";
import type * as providers_shared from "../providers/shared.js";
import type * as providers_types from "../providers/types.js";
import type * as providers_upscale from "../providers/upscale.js";
import type * as providers_video from "../providers/video.js";
import type * as providers_xai from "../providers/xai.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  billing: typeof billing;
  feedback: typeof feedback;
  generations: typeof generations;
  models: typeof models;
  "providers/audio": typeof providers_audio;
  "providers/env": typeof providers_env;
  "providers/fal": typeof providers_fal;
  "providers/image": typeof providers_image;
  "providers/openaiImage": typeof providers_openaiImage;
  "providers/router": typeof providers_router;
  "providers/seedanceVideo": typeof providers_seedanceVideo;
  "providers/shared": typeof providers_shared;
  "providers/types": typeof providers_types;
  "providers/upscale": typeof providers_upscale;
  "providers/video": typeof providers_video;
  "providers/xai": typeof providers_xai;
  uploads: typeof uploads;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
