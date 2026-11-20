# Watch protocol (version 1)

The tiny protocol between a watch and the OpenBlah server: start session, stop, mute, agent state, transcript line. It is the same for Apple Watch now and Wear OS later. The watch is a thin audio client; all logic (agent, tools, keys, limits) stays on the server. The code is `packages/server/src/watch.ts`.

## Transport

A WebSocket to the URL returned with the ticket. The watch connects to the cloud itself (watchOS routes through the iPhone, Wi-Fi or cellular), so it works with or without the phone nearby.

- **Text frames**: one JSON object each, at most 4096 bytes from the watch.
- **Binary frames**: audio. 16 kHz, mono, 16-bit signed PCM, little endian. Watch to server is the microphone; server to watch is the agent and other participants, mixed. Send chunks of about 100 ms (3200 bytes).

## Getting in

1. The watch (or the phone app, which hands the sign-in over) calls `POST /v1/me/watch/ticket` with `Authorization: Bearer <Firebase ID token>` and `{ "roomId": "rm_..." }`. The user must already be a participant of the room (start one with `POST /v1/me/calls`).
2. The answer is `{ "ticket", "expiresIn": 60, "protocol": 1, "socketUrl" }`. The ticket is signed, valid for one minute and tied to the user and the room.
3. The watch opens the socket and sends `start` with the ticket.

The endpoint answers 404 unless the server has `OPENBLAH_WATCH_SECRET` set. `OPENBLAH_WATCH_SOCKET_URL` is the `wss://` URL returned as `socketUrl`.

## Watch to server

| Message                                       | Meaning                                            |
| --------------------------------------------- | -------------------------------------------------- |
| `{"type":"start","version":1,"ticket":"..."}` | Join the room. Must be first.                      |
| `{"type":"mute","muted":true}`                | Mute or unmute the watch's microphone in the room. |
| `{"type":"stop"}`                             | Leave the room and close the socket.               |

## Server to watch

| Message                                                                            | Meaning                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `{"type":"started","roomId":"rm_...","agentName":"Blah"}`                          | Joined. Audio may flow.                                                     |
| `{"type":"muted","muted":true}`                                                    | Mute applied.                                                               |
| `{"type":"agent_state","state":"idle\|listening\|thinking\|speaking"}`             | The agent's state, for the screen and complication.                         |
| `{"type":"transcript","speaker":"Blah","text":"...","final":true}`                 | A transcript line. `final: false` is a partial that the next line replaces. |
| `{"type":"stopped","reason":"client\|room-ended\|idle\|error"}`                    | The session is over; the server closes the socket.                          |
| `{"type":"error","code":"bad_message\|unauthorized\|unsupported","message":"..."}` | `unauthorized` and `unsupported` also close the socket.                     |

If the socket drops, the server leaves the room. The watch starts a new session with a new ticket.
