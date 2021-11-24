/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { ApiRef, createApiRef } from '../system';
import { ProfileInfo } from './auth';

/*

- [ ] IdentityApi getProfile, make async
- [ ] BackstageIdentity (settle or remove)
- [ ] Evolution plan for utility APIs


*/

/**
 * This API provides access to the user's identity within Backstage.
 *
 * @remarks
 *
 * An auth provider that implements this interface can be used to sign-in to backstage. It is
 * not intended to be used directly from a plugin, but instead serves as a connection between
 * this authentication method and the app's {@link IdentityApi}
 *
 * @public
 */
export type BackstageIdentityApi = {
  /**
   * Get the user's identity within Backstage. This should normally not be called directly,
   * use the {@link IdentityApi} instead.
   *
   * If the optional flag is not set, a session is guaranteed to be returned, while if
   * the optional flag is set, the session may be undefined. See {@link AuthRequestOptions} for more details.
   */
  getBackstageIdentity(): Promise<BackstageIdentity | undefined>;
};

/**
 * A (user id, token) pair.
 *
 * @public
 */
export type BackstageIdentity = {
  /**
   * The backstage user ID.
   */
  id: string;

  /**
   * @deprecated This is deprecated, use `token` instead.
   */
  idToken: string;

  /**
   * The token used to authenticate the user within Backstage.
   */
  token: string;
};

/**
 * @public
 */
export type BackstageUserIdentity = {
  type: 'user';

  /**
   * The entityRef of the user in the catalog.
   * For example User:default/sandra
   */
  userEntityRef: string;

  /**
   * The user and group entities that the user claims ownership through
   */
  ownershipEntityRefs: string[];
};

/**
 * The Identity API used to identify and get information about the signed in user.
 *
 * @public
 */
export type IdentityApi = {
  /**
   * The ID of the signed in user. This ID is not meant to be presented to the user, but used
   * as an opaque string to pass on to backends or use in frontend logic.
   *
   * @deprecated use {@link IdentityApi.getIdentity} instead.
   */
  getUserId(): string;

  /**
   * An OpenID Connect ID Token which proves the identity of the signed in user.
   *
   * The ID token will be undefined if the signed in user does not have a verified
   * identity, such as a demo user or mocked user for e2e tests.
   *
   * @deprecated use {@link IdentityApi.getCredentials} instead.
   */
  getIdToken(): Promise<string | undefined>;

  /**
   * The profile of the signed in user.
   */
  getProfile(): Promise<ProfileInfo>;

  /**
   * User identity information within Backstage.
   */
  getIdentity(): BackstageUserIdentity;

  /**
   * Provides credentials in the form of a token which proves the identity of the signed in user.
   *
   * The token will be undefined if the signed in user does not have a verified
   * identity, such as a demo user or mocked user for e2e tests.
   */
  getCredentials(): Promise<{ token?: string }>;

  /**
   * Sign out the current user
   */
  signOut(): Promise<void>;
};

/**
 * The {@link ApiRef} of {@link IdentityApi}.
 *
 * @public
 */
export const identityApiRef: ApiRef<IdentityApi> = createApiRef({
  id: 'core.identity',
});
