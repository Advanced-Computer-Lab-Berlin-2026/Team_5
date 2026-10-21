# ACL — Team 5

Full Stack project for Advanced Computer Lab, Team 5. The current backbone uses Node.js, Express, and ES Modules (`import` / `export`). Feature routes, authentication, and database integration will be added as development progresses.

## Getting started

1. Copy `.env.example` to `.env` in the project root.
2. Replace the placeholder with their values, for example `BACKEND_PORT=3000`.
3. Install dependencies and start the backend from the `server` directory:

   ```bash
   cd server
   npm install
   npm run dev
   ```

Use Node.js 24 to match the CI environment. Commit `package-lock.json` whenever dependencies change; CI uses `npm ci` to install the locked dependency versions.

The server listens on the configured port. Nodemon restarts it when source files change. No feature endpoints are registered yet.

Keep secrets in `.env` and out of Git. Update `.env.example` with placeholders whenever a new environment variable is required.

## Project backbone

```text
.
├── .env.example
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
| `server/index.js` | Starts the server using the validated configuration. Database connection setup and other configs will run here before the server starts. |
| `server/app.js` | Creates and exports the Express app. Registers JSON parsing, authentication middleware, routes, and error handling as they are added. |
| `server/config/` | Holds application configuration. `env.js` loads the root `.env`, validates env if needed, and exports the `env` object. |
| `server/routes/` | Maps HTTP methods and URLs to controllers and applies middleware where needed. |
| `server/controllers/` | Handles requests, implements business logic, interacts with models, and sends responses. |
| `server/models/` | Defines database schemas and models. |
| `server/middleware/` | Holds shared request processing, such as authentication, validation, and error handling. |
| `server/tests/` | Holds automated tests for application behavior. Run them from `server` with `npm run test`. |

For protected endpoints, the intended request flow is:

```text
Request → JSON parsing → Authentication → Router → Controller → Model
                                                           → Response
```

Public endpoints, such as login, will be registered without authentication. 
Keeping app configuration in `app.js` separate from startup in `index.js` allows tests to import the app without starting a listening server.

Empty folders contain `.gitkeep` files so Git includes them. Remove these placeholders when actual files are added.

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
