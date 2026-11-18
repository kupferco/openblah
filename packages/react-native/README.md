# @openblah/react-native

React Native SDK for OpenBlah voice rooms. 0.x, unstable. Expo dev builds only, not Expo Go.

Same API as `@openblah/web`. Setup, audio behaviour and the example app: see [docs/react-native.md](../../docs/react-native.md).

## Ready component

`<OpenBlahRoom serverUrl token />` from `@openblah/react-native` is the whole call screen: join, mute, participants, agent state, consent, invite, agent control and tool approvals. Theme it with `theme`, reword it with `labels`, leave parts out with `hide` and build them yourself with the hooks. Same props in web and React Native. See [quickstart](../../docs/quickstart.md), [host integration](../../docs/host-integration.md), [API stability](../../docs/sdk-stability.md) and the [API reference](../../docs/api-reference/README.md).
