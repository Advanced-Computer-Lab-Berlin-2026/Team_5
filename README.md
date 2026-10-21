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

### Planned automated checks

CI pipelines for test execution, code coverage, and code quality checks will be added later. Until they are configured, authors and reviewers are responsible for running the relevant checks locally. Automated checks will support peer review, and all PRs will still require it.
