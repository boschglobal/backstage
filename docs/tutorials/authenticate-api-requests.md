---
id: authenticate-api-requests
title: Authenticating API Requests
description: Guide for authenticating API requests within Backstage
---

> This document has been moved over from the community contributed docs
> directory and will continue to evolve as request authentication/authorization
> becomes a first-class citizen of Backstage. The approach described here is now
> fully supported and functional end-to-end, but will eventually be replaced in
> favor of a built-in framework that will broadly support authentication and
> authorization needs within Backstage.

# Authenticate API requests

The Backstage backend APIs are by default available without authentication. To
avoid evil-doers from accessing or modifying data, one might use a network
protection mechanism such as a firewall or an authenticating reverse proxy. For
Backstage instances that are available on the Internet one can instead use the
experimental IdentityClient as outlined below.

API requests from frontend plugins include an authorization header with a
Backstage identity token acquired when the user logs in. By adding a middleware
that verifies said token to be valid and signed by Backstage, non-authenticated
requests can be blocked with a 401 Unauthorized response.

**NOTE**: Enabling this means that Backstage will stop working for guests, as no
token is issued for them.

Since the middleware always expects a valid token, API requests from backend
plugins will need one as well. Backends have no concept of a Backstage identity
so instead they use a token generated using a shared key from the
`app-config.yaml`. You can generate a unique key for your app in a terminal, and
set the `BACKEND_SECRET` environment variable to the resulting value.

```bash
node -p 'require("crypto").randomBytes(24).toString("base64")'
```

As techdocs HTML pages load assets without an Authorization header the code
below also sets a token cookie when the user logs in (and when the token is
about to expire).

```typescript
// packages/backend/src/index.ts from a create-app deployment

import cookieParser from 'cookie-parser';
import { Request, Response, NextFunction } from 'express';
import { JWT } from 'jose';
import { URL } from 'url';
import { IdentityClient } from '@backstage/plugin-auth-backend';

// ...

function setTokenCookie(
  res: Response,
  options: { token: string; secure: boolean; cookieDomain: string },
) {
  try {
    const payload = JWT.decode(options.token) as object & {
      exp: number;
    };
    res.cookie(`token`, options.token, {
      expires: new Date(payload?.exp ? payload?.exp * 1000 : 0),
      secure: options.secure,
      sameSite: 'lax',
      domain: options.cookieDomain,
      path: '/',
      httpOnly: true,
    });
  } catch (_err) {
    // Ignore
  }
}

async function main() {
  // ...

  const discovery = SingleHostDiscovery.fromConfig(config);
  const identity = new IdentityClient({
    discovery,
    issuer: await discovery.getExternalBaseUrl('auth'),
  });
  const baseUrl = config.getString('backend.baseUrl');
  const secure = baseUrl.startsWith('https://');
  const cookieDomain = new URL(baseUrl).hostname;
  const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token =
        IdentityClient.getBearerToken(req.headers.authorization) ||
        req.cookies['token'];

      // Authenticate all requests originating from backends by default
      const isValidServerToken = await authEnv.tokenManager.validateServerToken(
        token,
      );
      if (!isValidServerToken) {
        req.user = await identity.authenticate(token);
      }

      if (!req.headers.authorization) {
        // Authorization header may be forwarded by plugin requests
        req.headers.authorization = `Bearer ${token}`;
      }
      if (token !== req.cookies['token']) {
        setTokenCookie(res, {
          token,
          secure,
          cookieDomain,
        });
      }
      next();
    } catch (error) {
      res.status(401).send(`Unauthorized`);
    }
  };

  const apiRouter = Router();
  apiRouter.use(cookieParser());
  // The auth route must be publically available as it is used during login
  apiRouter.use('/auth', await auth(authEnv));
  // Add a simple endpoint to be used when setting a token cookie
  apiRouter.use('/cookie', authMiddleware, (_req, res) => {
    res.status(200).send(`Coming right up`);
  });
  // Only authenticated requests are allowed to the routes below
  apiRouter.use('/catalog', authMiddleware, await catalog(catalogEnv));
  apiRouter.use('/techdocs', authMiddleware, await techdocs(techdocsEnv));
  apiRouter.use('/proxy', authMiddleware, await proxy(proxyEnv));
  apiRouter.use(authMiddleware, notFoundHandler());

  // ...
}
```

```typescript
// packages/app/src/App.tsx from a create-app deployment

import { discoveryApiRef, useApi } from '@backstage/core-plugin-api';

// ...

// Parses supplied JWT token and returns the payload
function parseJwt(token: string): { exp: number } {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(''),
  );

  return JSON.parse(jsonPayload);
}

// Returns milliseconds until the supplied JWT token expires
function msUntilExpiry(token: string): number {
  const payload = parseJwt(token);
  const remaining =
    new Date(payload.exp * 1000).getTime() - new Date().getTime();
  return remaining;
}

// Calls the specified url regularly using an auth token to set a token cookie
// to authorize regular HTTP requests when loading techdocs
async function setTokenCookie(url: string, getIdToken: () => Promise<string>) {
  const token = await getIdToken();
  await fetch(url, {
    mode: 'cors',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  // Call this function again a few minutes before the token expires
  const ms = msUntilExpiry(token) - 4 * 60 * 1000;
  setTimeout(
    () => {
      setTokenCookie(url, getIdToken);
    },
    ms > 0 ? ms : 10000,
  );
}

const app = createApp({
  // ...

  components: {
    SignInPage: props => {
      const discoveryApi = useApi(discoveryApiRef);
      return (
        <SignInPage
          {...props}
          providers={['guest', 'custom', ...providers]}
          title="Select a sign-in method"
          align="center"
          onResult={async result => {
            // When logged in, set a token cookie
            if (typeof result.getIdToken !== 'undefined') {
              setTokenCookie(
                await discoveryApi.getBaseUrl('cookie'),
                result.getIdToken,
              );
            }
            // Forward results
            props.onResult(result);
          }}
        />
      );
    },
  },

  // ...
});

// ...
```

**NOTE**: Most Backstage frontend plugins come with the support for the
`IdentityApi`. In case you already have a dozen of internal ones, you may need
to update those too. Assuming you follow the common plugin structure, the
changes to your front-end may look like:

```diff
// plugins/internal-plugin/src/api.ts
-  import { createApiRef } from '@backstage/core-plugin-api';
+  import { createApiRef, IdentityApi } from '@backstage/core-plugin-api';
import { Config } from '@backstage/config';
// ...

type MyApiOptions = {
    configApi: Config;
+   identityApi: IdentityApi;
    // ...
}

interface MyInterface {
    getData(): Promise<MyData[]>;
}

export class MyApi implements MyInterface {
    private configApi: Config;
+   private identityApi: IdentityApi;
    // ...

    constructor(options: MyApiOptions) {
        this.configApi = options.configApi;
+       this.identityApi = options.identityApi;
    }

    async getMyData() {
        const backendUrl = this.configApi.getString('backend.baseUrl');

+       const token = await this.identityApi.getIdToken();
        const requestUrl = `${backendUrl}/api/data/`;
-       const response = await fetch(requestUrl);
+       const response = await fetch(
          requestUrl,
          { headers: { Authorization: `Bearer ${token}` } },
        );
    // ...
   }
```

and

```diff
// plugins/internal-plugin/src/plugin.ts

import {
    configApiRef,
    createApiFactory,
    createPlugin,
+   identityApiRef,
} from '@backstage/core-plugin-api';
import { myPluginPageRouteRef } from './routeRefs';
import { MyApi, myApiRef } from './api';

export const plugin = createPlugin({
    id: 'my-plugin',
    routes: {
        mainPage: myPluginPageRouteRef,
    },
    apis: [
        createApiFactory({
            api: myApiRef,
            deps: {
                configApi: configApiRef,
+               identityApi: identityApiRef,
            },
-           factory: ({ configApi }) =>
-               new MyApi({ configApi }),
+           factory: ({ configApi, identityApi }) =>
+               new MyApi({ configApi, identityApi }),
        }),
    ],
});
```

In the (probably unlikely) case that you need to authenticate from a backend
plugin, the plugin environment contains a `tokenManager` that will provide a
server token to use in the request. It is a noop `tokenManager` by default --
you'll need to instantiate a new one using the secret from your config instead:

```diff
// packages/backend/src/index.ts

function makeCreateEnv(config: Config) {
  const root = getRootLogger();
  const reader = UrlReaders.default({ logger: root, config });
  const discovery = SingleHostDiscovery.fromConfig(config);

  root.info(`Created UrlReader ${reader}`);

  const cacheManager = CacheManager.fromConfig(config);
  const databaseManager = DatabaseManager.fromConfig(config);
- const tokenManager = ServerTokenManager.noop();
+ const tokenManager = ServerTokenManager.fromConfig(config);
```

With this `tokenManager`, you can then generate a server token for requests:

```
const { token } = await this.tokenManager.getServerToken();
```