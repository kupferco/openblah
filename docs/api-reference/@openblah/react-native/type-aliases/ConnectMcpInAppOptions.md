# Type Alias: ConnectMcpInAppOptions

> **ConnectMcpInAppOptions** = `Omit`\<[`ConnectMcpServerOptions`](../../web/interfaces/ConnectMcpServerOptions.md), `"openAuthorization"` \| `"isCancelled"`\> & `object`

## Type Declaration

### openAuthSession?

> `optional` **openAuthSession?**: (`url`) => `Promise`\<\{ `type?`: `string`; \} \| `unknown`\>

Show the consent page. Pass `(url) => WebBrowser.openAuthSessionAsync(url)` from
`expo-web-browser` for an in-app sheet that also reports when it is dismissed.
Default: open the system browser with `Linking.openURL`.

#### Parameters

##### url

`string`

#### Returns

`Promise`\<\{ `type?`: `string`; \} \| `unknown`\>
