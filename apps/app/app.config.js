/* global process, module */
// Free-account build by default (signed with a personal Apple ID through Xcode).
// Set EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1 before `expo prebuild` / `eas build` to add what needs the
// paid Apple Developer Program: Sign in with Apple, Associated Domains (universal links) and the
// Android App Links filter. The same variable switches the Apple button on in the app (src/config.ts).
const paid = process.env.EXPO_PUBLIC_OPENBLAH_PAID_APPLE === "1";

module.exports = ({ config }) => {
  if (!paid) return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      associatedDomains: ["applinks:openblah.web.app", "webcredentials:openblah.web.app"],
      usesAppleSignIn: true,
    },
    android: {
      ...config.android,
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host: "openblah.web.app", pathPrefix: "/j/" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [...(config.plugins ?? []), "expo-apple-authentication"],
  };
};
