/**
 * Expo config plugin for @openblah/react-native. Add it to `plugins` in app.json:
 *
 *   "plugins": [["@openblah/react-native/plugin", { "microphonePermission": "..." }]]
 *
 * It applies the LiveKit and WebRTC plugins, then adds what a call needs to survive
 * screen lock: the iOS `audio` background mode, the microphone usage text, and
 * the Android audio permissions.
 */
const {
  withPlugins,
  withInfoPlist,
  withAndroidManifest,
  AndroidConfig,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const DEFAULT_MIC_TEXT = "Allow $(PRODUCT_NAME) to use the microphone for voice calls.";
const ANDROID_PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.INTERNET",
];

/** A required plugin may be a CommonJS function or an ES module with a default export. */
function interopDefault(mod) {
  return mod && typeof mod === "object" && "default" in mod ? mod.default : mod;
}

/** Pure helper so it can be tested: add `audio` to UIBackgroundModes and the mic text. */
function applyIosInfoPlist(plist, microphonePermission) {
  const modes = new Set(plist.UIBackgroundModes ?? []);
  modes.add("audio");
  plist.UIBackgroundModes = [...modes];
  plist.NSMicrophoneUsageDescription = plist.NSMicrophoneUsageDescription ?? microphonePermission;
  return plist;
}

function withOpenBlah(config, options = {}) {
  const microphonePermission = options.microphonePermission ?? DEFAULT_MIC_TEXT;
  return withPlugins(config, [
    [
      interopDefault(require("@livekit/react-native-expo-plugin/app.plugin.js")),
      options.livekit ?? {},
    ],
    [interopDefault(require("@config-plugins/react-native-webrtc")), { microphonePermission }],
    (c) =>
      withInfoPlist(c, (m) => {
        applyIosInfoPlist(m.modResults, microphonePermission);
        return m;
      }),
    (c) =>
      withAndroidManifest(c, (m) => {
        m.modResults = AndroidConfig.Permissions.ensurePermissions(
          m.modResults,
          ANDROID_PERMISSIONS,
        );
        return m;
      }),
  ]);
}

module.exports = createRunOncePlugin(withOpenBlah, "@openblah/react-native", "0.0.1");
module.exports.applyIosInfoPlist = applyIosInfoPlist;
module.exports.ANDROID_PERMISSIONS = ANDROID_PERMISSIONS;
module.exports.interopDefault = interopDefault;
