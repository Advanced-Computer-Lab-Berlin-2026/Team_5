# ACL — Team 5

Full Stack project for Advanced Computer Lab, Team 5. The backend uses Node.js, Express, ES Modules (`import` / `export`), and MongoDB through Mongoose. It currently provides health checks, registration, cookie-based authentication, and password recovery.

## Getting started

1. Copy `.env.sample` to `.env` in the project root.
2. Fill in all required values listed below. Use `NODE_ENV=local` for local HTTP development.
3. Install dependencies and start the backend from the `server` directory:

   ```bash
   cd server
   npm install
   npm run dev
   ```

Use Node.js 24 to match the CI environment. Commit `package-lock.json` whenever dependencies change; CI uses `npm ci` to install the locked dependency versions.

The server listens on the configured port. Nodemon restarts it when source files change. Startup connects to MongoDB before listening. Check `GET /api/health` to confirm the API is responding.

Keep secrets in `.env` and out of Git. Update `.env.sample` with placeholders whenever a new environment variable is required.


### Required environment values

| Variable | Purpose |
| --- | --- |
| `BACKEND_PORT` | HTTP listening port, for example `3000`. |
| `JWT_SECRET` | Strong random secret used to sign and verify access JWTs. Keep it private and consistent across instances. |
| `MONGODB_URI` | MongoDB connection URI. |
| `SMTP_PASS` | Credentials for the sender configured in `server/services/emailService.js`. |
| `NODE_ENV` | Use `local` locally and `production` for deployment over HTTPS. Only the exact value `production` enables Secure auth cookies. |

All five values must be nonempty. Configuration is captured at module load;
restart the server after changing it.

On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`.

## Project backbone

### Auth security configuration

Set `NODE_ENV=production` when deploying over HTTPS. Both auth cookies then use
`Secure`; local HTTP development keeps them usable without HTTPS.

CSRF protection is mounted once at `/api` before all API routers. POST, PUT,
PATCH, DELETE, and other unsafe methods must supply a trusted `Origin`, or a
`Referer` with a trusted origin when Origin is absent. Missing, null, and
untrusted origins return 403 before the controller runs, even with valid auth
cookies. GET, HEAD, and OPTIONS bypass this check; GET and HEAD handlers must
never change data. Protected read routes still need `requireAuth`.

The trusted origin is currently hardcoded to `http://localhost:3000` in
`server/middleware/authSecurity.js`; update it for the actual frontend before
deployment. There is currently no `AUTH_ALLOWED_ORIGINS` environment setting.
Postman and command-line clients must explicitly send the Origin header on
unsafe requests. Browsers supply it automatically. This check does not enable
CORS, authenticate users, or replace ownership checks. Keep auth cookies
`HttpOnly` and `SameSite=Strict`, with `Secure` enabled in production.

Auth limits are per client IP: login allows 20 requests per 15 minutes,
registration 10 per 15 minutes, and the three password reset endpoints share
10 per 15 minutes. Refresh allows 60 requests per minute and logout 30 per
minute. Exceeding a budget returns 429 with `Retry-After`. These limits use an
in-memory store for a single server process; multiple instances need a shared
store. Behind a reverse proxy, configure Express `trust proxy` for the actual
trusted proxy addresses before deployment so requests are counted by client IP.
Do not blindly trust arbitrary forwarded headers.

Only one concurrent refresh can rotate a token. A rejected refresh returns 401
without clearing cookies, preserving the winning request's cookies. Browser
clients should coordinate refreshes and retry pending requests after the shared
refresh succeeds; do not automatically log out on a losing concurrent refresh.

```text
.
├── .env.sample
├── README.md
└── server/
    ├── index.js
    ├── app.js
    ├── package.json
    ├── config/
    │   └── env.js
    ├── controllers/
    ├── middleware/
    ├── models/
    ├── routes/
    └── tests/
```

| File or folder | Responsibility |
| --- | --- |
| `server/index.js` | Starts the server using the validated configuration. Connects to MongoDB before starting the HTTP listener. |
| `server/app.js` | Creates and exports the Express app. Registers cookie parsing, API-wide CSRF protection, JSON parsing, routes, and error handling. |
| `server/config/` | Holds application configuration. `env.js` loads the root `.env`, requires the configured values, and exports the named `env` object. |
| `server/routes/` | Maps HTTP methods and URLs to controllers and applies middleware where needed. |
| `server/controllers/` | Handles requests, implements business logic, interacts with models, and sends responses. |
| `server/models/` | Defines database schemas and models. |
| `server/middleware/` | Holds shared request processing, such as authentication, validation, and error handling. |
| `server/tests/` | Holds automated tests for application behavior. Run them from `server` with `npm run test`. |

For protected endpoints, the intended request flow is:

```text
Request -> Cookie parsing -> CSRF check -> JSON parsing -> Router
        -> requireAuth -> Role/ownership checks -> Controller -> Model -> Response
```

Public endpoints, such as login, do not require an access token. Their unsafe requests still pass the CSRF origin check and endpoint rate limits.
Keeping app configuration in `app.js` separate from startup in `index.js` allows tests to import the app without starting a listening server.

Empty folders contain `.gitkeep` files so Git includes them. Remove these placeholders when actual files are added.


## Authentication and API usage

All request bodies below are JSON. Responses use JSON, including errors with
`{ message }`. Auth endpoints are mounted under `/api/auth`.

| Method and path | Request body | Successful behavior |
| --- | --- | --- |
| `GET /api/health` | None | Returns `{ "status": "ok" }`. |
| `POST /api/auth/register` | `username`, `name`, `email`, `password`; optional `phoneNumber`, `homeAddress` | Creates a member; user must then log in. |
| `POST /api/auth/login` | `username`, `password` | Sets both auth cookies and returns public user information. |
| `POST /api/auth/refresh` | None; refresh cookie required | Consumes the existing refresh session and issues new access and refresh cookies. |
| `POST /api/auth/logout` | None | Deletes the matching refresh session, clears both cookies, and succeeds even without a cookie. |
| `POST /api/auth/forget-password` | `email` | Sends a six-digit code if the account exists; returns the same success message for unknown accounts. |
| `POST /api/auth/verify-reset-otp` | `email`, `otp` as a six-digit string | Exchanges the code for a reset token returned in JSON. |
| `POST /api/auth/reset-password` | `resetToken`, `newPassword` | Changes the password, revokes all of the user's refresh sessions, and clears this browser's auth cookies. |

The password recovery URL is spelled `forget-password`, matching the current
router. Reset codes expire after 10 minutes and allow at most five verification
attempts per issued code. Successful verification exchanges the code once for
a reset token valid for five minutes. Reset tokens can be used only once.

### Cookie lifecycle

| Cookie | Contents | Lifetime | Path |
| --- | --- | --- | --- |
| `accessToken` | Signed JWT containing user ID and role | 15 minutes | `/` |
| `refreshToken` | Cryptographically random credential; only its SHA-256 hash is stored in MongoDB | Seven days from issuance | `/api/auth` |

Both cookies are HttpOnly and SameSite=Strict, with Secure enabled in production.
The browser stores and sends them automatically on matching requests; frontend
JavaScript should not read or store these auth tokens. No Authorization bearer
header is supported by `requireAuth`. Refreshing renews the seven-day window;
there is currently no absolute session lifetime across repeated refreshes.

For a frontend on a different origin, use `credentials: 'include'` on fetch
requests. The backend currently has no CORS configuration: separate-origin
browser access needs an explicit CORS policy allowing the trusted frontend and
credentials, or a development proxy that serves API requests through the
frontend origin. CORS, CSRF origin checks, and SameSite cookie rules are separate
requirements; enabling one does not enable the others. Browser JavaScript
should not attempt to set the Origin header itself.

On a protected request, an expired JWT returns 401 with `code: 'TOKEN_EXPIRED'`.
However, the browser may already have removed the expired cookie, which instead
returns 401 with `Authentication required`. Handle either case by coordinating
one refresh request, then retrying the original request once after success.
Do not refresh recursively when the refresh endpoint itself returns 401.

### Protecting new routes

Import `requireAuth` and `requireRole` from `server/middleware/auth.js`.
Use `router.use(requireAuth)` before routes when the entire router is private,
or attach `requireAuth` to individual routes in a mixed public/private router.
Run it before `requireRole('admin')` or another allowed-role list. Every
protected request must pass authentication, including GET requests.

After verification, `req.user` contains `{ id, role }`. Use that ID to scope
database queries to the caller's records; never take the caller's identity from
a request body or URL. Role checks do not replace record ownership checks.
Register new API routers in `server/app.js` after the shared middleware and
before the 404 and error handlers so they inherit CSRF protection.

`requireAuth` checks the JWT signature, the HS256 algorithm, expiry, and the
presence of a user ID. It does not query the current user or session on every
request. A copied access token can remain usable until expiry after logout or
password reset, and role changes can take up to 15 minutes to take effect.
Suspended-account enforcement is not implemented yet. Immediate revocation
would require an additional server-side user/session check.

### CSRF and errors

CSRF (Cross-Site Request Forgery) is an attempt by another website to make a
logged-in browser perform an unwanted action using automatically attached
cookies. The API-wide origin check blocks untrusted sources before controllers
run. It complements authentication and SameSite cookies; it does not protect
against malicious JavaScript already running inside the trusted frontend.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input or malformed JSON. |
| 401 | Missing, invalid, or expired authentication/reset credential. |
| 403 | Untrusted request origin, or insufficient role on a protected route. |
| 404 | Endpoint or requested resource not found. |
| 409 | Registration conflicts with an existing username or email. |
| 429 | Per-IP auth rate limit exceeded; respect Retry-After. |
| 500 | Server failure; detailed errors are logged instead of returned to clients. |

In Postman, send `Origin: http://localhost:3000` with unsafe requests and enable
the cookie jar so login cookies carry over to later calls. A 403 origin error
is distinct from a 401 authentication failure: valid cookies do not bypass
CSRF checks.

## Project guidelines

### AI usage

AI may be used for research, explanations, and understanding concepts. Copying and pasting AI-generated code into the project is not allowed. Team members must write and understand their own code.

AI can miss the project's boundaries and constraints, producing code that works but adds behavior or complexity we do not need. To keep the project simple and support learning, use AI as a tool for understanding rather than a source of code to copy. Also easier to review.

### Tickets and pull requests

Every pull request must correspond to a Jira ticket and reference it in the PR description. Implement the features required by that ticket, write the necessary tests, and test the changes locally before moving the ticket to review.

All pull requests must be peer reviewed before merging. Jira will include a **PR Pending** column where team members can pick up tickets to review. Move a ticket there once the PR is ready and include a link to the PR.

The reviewer must:

- Pull the changes locally and test the affected behavior.
- Check that the implementation is clear, understandable, and limited to what the ticket requires.
- Run the relevant tests and confirm that all available checks pass.
- Request changes when needed and approve only after review concerns are resolved.

### Testing and code quality

Run these commands from `server`:

| Command | Purpose |
| --- | --- |
| `npm start` | Starts the backend without automatic restarts. |
| `npm run dev` | Starts the backend with Nodemon and restarts it on code changes. |
| `npm test` | Runs Vitest tests once. |
| `npm run test:watch` | Keeps Vitest running and reruns affected tests as files change. |
| `npm run test:coverage` | Runs tests once and collects coverage using `@vitest/coverage-v8`. |
| `npm run lint` | Checks JavaScript using ESLint without changing files. |
| `npm run lint:fix` | Applies automatically fixable ESLint corrections. Review the resulting changes. |

Write tests in `server/tests/` using names such as `app.test.js`. Coverage already runs the tests, so a separate test run is not needed when running coverage. Vitest exits with a failure when no test files are found.

Coverage reports are generated in `server/coverage/`. Open `server/coverage/index.html` to inspect the HTML report locally. Generated reports and `node_modules/` are ignored by Git. No minimum coverage threshold is configured yet; coverage measures execution and does not guarantee that assertions verify the right behavior.

The rules in `server/eslint.config.js` include recommended JavaScript checks, Node.js globals, strict equality, and a preference for `const` where reassignment is unnecessary. Maintainability warnings flag cyclomatic complexity above 10, nesting deeper than 4 levels, and functions with more than 4 parameters. Lint errors fail the check; these warnings currently do not. Complexity issues require manual review and refactoring.

### Continuous integration

The **ACL Code Check** workflow is defined in [`.github/workflows/acl-server-code-check.yml`](.github/workflows/acl-server-code-check.yml). It runs on pushes to any branch and on pull requests targeting `main`. Updating a branch with an open PR to `main` can trigger both events.

The workflow runs on Ubuntu with Node.js 24 and performs these steps:

1. Checks out the repository.
2. Sets up Node.js.
3. Installs backend dependencies with `npm ci` in `server`.
4. Runs ESLint.
5. Runs tests with coverage.
6. Uploads `server/coverage/` as the `coverage-report` artifact.

View results and download the report from the repository's **Actions** tab. Steps run in order; a failure skips subsequent steps, including the report upload. Authors should run lint and coverage locally before moving a Jira ticket to **PR Pending**. Reviewers must still pull and test changes locally.

### Merge requirements

Every PR must pass CI and receive at least one peer approval before merging into `main`. Repository administrators should configure an active branch ruleset targeting `main` that requires pull requests, the `acl-code-check` status check, and at least one approval. Enable dismissal of stale approvals when new commits are pushed so updated code is reviewed again.

These requirements are enforced by GitHub repository settings, not by this README or the workflow alone. Confirm that the ruleset is active and supported by the repository's visibility and account plan. Automated checks support peer review; they do not replace it.
