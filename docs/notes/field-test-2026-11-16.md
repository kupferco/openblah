# Field test: three-way call (16 Nov 2026)

Design inputs from a real call: Dani, his colleague Ryan, and Claude in voice mode. Phone in pocket, voice only. Linked from [plan.md](../plan.md), sections 2.3 to 2.5, the roadmap and the open questions.

## Findings

1. **It worked.** Three people on one call, and a real task was created and then corrected live (a city changed from Leeds to Manchester mid-conversation).
2. **Turn-taking is the main problem.** The AI jumped in on short pauses (1-2 s) and talked over people.
3. **Handoffs between humans were clumsy.** After "go on, Ryan" the AI did not recognise the handoff.
4. **Speaker labels.** The AI often could not tell who was speaking.
5. **Latency masking ideas** (from Ryan's work on conversational AI): a short acknowledgement while the answer loads, and streaming the reply.
6. **Positioning.** Voice first, phone in pocket, people walking around. Not competing with Meet/Teams (video, screens, desks).
7. **Value shown.** Ideas became tasks during the call: Ryan's request became a task in minutes, and his follow-up idea went to the backlog.

## Design inputs

| #   | Input                                                                                                    | Where it fits in the plan                                           |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 2   | Longer end-of-turn wait in group calls (more than the 1-2 s that failed)                                 | 2.4, open question 7                                                |
| 2   | Speak only when addressed by name or asked a clear question, otherwise listen                            | Already in 2.5; this test confirms it                               |
| 2   | Semantic end-of-turn model (words and tone), not silence alone                                           | 2.4                                                                 |
| 2   | Optional soft cue (sound or light) when the AI wants to speak, so people can say "go ahead" or ignore it | 2.5, open question 8                                                |
| 3   | Recognise a handoff to another person ("go on, Ryan") and stay quiet                                     | 2.5                                                                 |
| 4   | Tag each participant's audio and transcript with their name                                              | Already in 2.3 (per-participant tracks); keep it a hard requirement |
| 5   | Acknowledge briefly while the answer loads; stream the reply                                             | 2.3 latency target                                                  |
| 6   | Voice-first, phone-in-pocket positioning                                                                 | Section 1                                                           |
| 7   | Live idea-to-task and idea-to-backlog flow as the demo scenario                                          | MVP scope and demo                                                  |

## Open questions from this test

- How long should the end-of-turn wait be in a group call, and does it differ from a one-to-one call?
- Is the soft cue worth building in the MVP, and which form (sound, light, vibration) works with the phone in a pocket?
