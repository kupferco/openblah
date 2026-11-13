# Working notes for Claude

<!-- viber:start -->
## Sessions started by Viber

When the prompt says it comes from Viber, Dani is away from his computer and
will review through a preview link, so these rules replace any local ones
about waiting for him before committing:

- You are already on the task's `feat/` branch. Commit your work there.
  Don't push, open a pull request or merge: the workflow does that.
- Don't run the app or start servers. Do run the repo's checks (typecheck,
  tests, build) before your last commit, and fix what they find.
- Never deploy, never touch production, and never change a deployed
  database.
- You can post to the pull request with `gh` (the workflow allows pull-requests
  and issues write): `gh pr comment <number> --body-file notes.md` to add a
  comment, `gh pr edit <number> --body-file body.md` to change its description.
  Find the number with `gh pr view --json number`. Before the first run ends there
  is no PR yet (Viber opens it), so use `viber-pr.md` then. Your final message is
  stored by Viber as the task's "Final answer", so answer questions there too.
- If the brief is unclear or would break a rule in this file, change nothing
  and explain why in the pull request description.

## Preview test login

Every preview build offers a one-tap sign-in as a shared test user, so the
reviewer never types credentials on a throwaway URL. When you touch login,
auth or seed data, keep these rules:

- **Preview only.** Show the credentials (prefilled, or a "Sign in as test
  user" button) only when the app runs as a preview (`APP_ENV=preview` or
  the equivalent) AND the secret `PREVIEW_TEST_PASSWORD` is set. Decide it
  on the server, or in a build flag that production builds cannot set. Never
  derive it from the URL or a query parameter. It must be off in staging and
  production, and a test must prove that.
- **The real login still runs.** The button fills in or submits the normal
  form. Do not add a bypass, a magic token or a second auth path.
- **One fixed user, never one per preview.** Email `preview-test@viber.invalid`,
  password from `PREVIEW_TEST_PASSWORD`. Create it in the preview seed, not
  at runtime, and never in production or staging.
- **Never in code.** The password is the repo Actions secret
  `PREVIEW_TEST_PASSWORD`, which Viber manages. The preview deploy passes
  it to the preview service as an environment variable; do not commit it,
  log it, or add it to a non-preview deploy.
- **Marked as a test account.** Give the user an `is_test` flag (or claim)
  and leave it out of analytics, metrics, user counts and exports.
- **Only its own sample data.** The test user sees only seeded fake data in
  the preview database, never real user data, never prod or staging data.
  Where an app holds personal, patient or billing data, scope every query by
  the user so the test user cannot see anyone else's rows.

## Steps only the owner can do

Viber has a stage "Fix on the computer" for failures that no coding
session can fix. When a script or pipeline step fails because it needs owner
or human action (permission denied, a missing IAM role, a secret only the
owner can set, a one-time owner-only setup script), print one line before it
exits, so Viber doesn't offer "Send back to fix" for it:

`::viber-manual::{"reason":"...","action":"...","commands":["..."],"verify":"..."}`

- `reason`: why it stopped, one plain sentence ("the deploy account lacks storage.buckets.create").
- `action`: the exact thing to do, who must do it and where.
- `commands`: what to run, in order (empty if it is a console step).
- `prerequisites` (optional): what must be set up first, e.g. `gcloud auth login`
  and `gcloud config set project <id>` for a GCP step.
- `verify`: how to tell it worked.

Text fields (`reason`, `action`, `verify`) and lists (`commands`,
`prerequisites`) each accept either a string or an array of strings; arrays
are shown one item per line.

Never write a vague "run X as owner" in a pull request or a summary. If a task
can't continue without Dani doing something by hand, use this marker (or the
`manual` field of the deploy report) so Viber shows the full request: the
workspace to open, the branch to be on, the prerequisites and a prompt for
Claude Code. Say in `action` on which branch the script lives.

The deploy report works the same way. In the step "Tell Viber how the deploy
went", POST to `$VIBER_URL/hooks/deploy` with the bearer secret:

```json
{"repo":"owner/name","env":"staging","sha":"<commit>","branch":"<branch>","outcome":"needs_manual",
 "runUrl":"<run page>","manual":{"reason":"...","action":"...","commands":["..."],"verify":"..."}}
```

- `outcome` is `deployed`, `failed` or `needs_manual` (an owner step; send `manual` with it).
- `env` is `staging` or `prod`; for a PR preview send `preview` and the `branch`.
- `plan`, `planHash`, `manual` and `log` may be left out or null. Too-long text is cut.
- A rejected report answers 400 with the bad fields named.

Plain text after the marker works too and becomes the reason. Use it only
for steps a person must do by hand, never for ordinary errors or test
failures. The deploy pipeline sends the log with its report to Viber.

## Telling Viber about previews and deploys

Viber learns a preview is ready, and that a production deploy finished, only
from steps in the app's own workflows. Both use the repo secrets `VIBER_URL`
and `VIBER_HOOK_SECRET`. Simplest: one step that calls Viber's action
(it never fails the job):

```yaml
# after the preview deploy
- uses: kupferco/viber/.github/actions/report@main
  with: { kind: preview, url: "<preview url>", viber-url: "${{ secrets.VIBER_URL }}", hook-secret: "${{ secrets.VIBER_HOOK_SECRET }}" }
# after the production deploy, on success and on failure
- uses: kupferco/viber/.github/actions/report@main
  if: always()
  with: { kind: deploy, env: prod, outcome: "${{ job.status == 'success' && 'deployed' || 'failed' }}", viber-url: "${{ secrets.VIBER_URL }}", hook-secret: "${{ secrets.VIBER_HOOK_SECRET }}" }
```

The same by hand, header `Authorization: Bearer $VIBER_HOOK_SECRET`, JSON body:

```sh
# preview ready (branch = the PR's head branch)
curl -sS -X POST "$VIBER_URL/hooks/preview" -H "Authorization: Bearer $VIBER_HOOK_SECRET" \
  -H "Content-Type: application/json" -d '{"repo":"owner/name","branch":"feat/x","url":"https://..."}'
# production deploy result: outcome is deployed or failed, sha the deployed commit
curl -sS -X POST "$VIBER_URL/hooks/deploy" -H "Authorization: Bearer $VIBER_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"repo":"owner/name","env":"prod","sha":"<sha>","outcome":"deployed","runUrl":"<run page>"}'
```

A workflow that deploys to production without the deploy report leaves its
tasks stuck on "Deploying to prod". Add the step when you touch that workflow.
<!-- viber:end -->
