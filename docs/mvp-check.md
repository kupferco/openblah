# MVP success test

The test that says the voice SDK works end to end: a real 10-minute call between Dani and Penelope with the agent in the room. Run it once the 0.1.0 packages are published and the app is deployed (see the release steps below).

## Setup

- Dani and Penelope each on their own phone or browser, in different places, using the deployed server and agent.
- One room, agent enabled (default model settings). Penelope joins by invite link.
- Someone keeps a written list of what was said (topics, decisions, one action item each) to compare against the notes.

## Script (10 minutes)

1. **0:00 to 1:00, join.** Both join. Check each hears the other and the agent shows as listening.
2. **1:00 to 6:00, talk normally.** Dani and Penelope plan something real (for example a weekend trip). Include one decision and one action item each. Do not address the agent.
3. **6:00 to 8:00, ask the agent.** Dani asks it something directly ("Blah, what did we decide about the day?"). Later Penelope asks a follow-up by name.
4. **8:00 to 9:00, talk to each other again**, including a short side question to each other that is not for the agent.
5. **9:00 to 10:00, wrap up.** Ask the agent for the notes, then end the call.

## Pass criteria

- **Silent while they talk:** in steps 2 and 4 the agent speaks zero times (a single stray interjection counts as a fail; note when).
- **Answers when asked:** in step 3 it answers within a few seconds, each time, and the answer is correct against what was said.
- **Correct notes:** the notes list the real topics, the decision and both action items, with no invented facts and nothing important missing.
- **Basics:** no dropped call, no audio problem lasting more than a few seconds, and the cost of the call is in line with `docs/costs.md`.

Record the result (date, pass/fail per criterion, quotes of any miss) in this file under a "Results" heading.

## Results

None yet.

## Release steps (Dani)

1. Create the `@openblah` npm organisation (or confirm the scope) and an automation token. Add it as the repo secret `NPM_TOKEN`.
2. Optionally run Actions > Release with "Dry run" ticked.
3. Run Actions > Release (or push tag `v0.1.0`). It publishes `@openblah/core`, `web`, `react-native` and `server` at 0.1.0 with provenance.
4. Run this test with Penelope.
