// ---------------------------------------------------------------------------
// Config plugin: register the Health Connect permission delegate.
//
// react-native-health-connect's README claims the Expo module registers
// HealthConnectPermissionDelegate automatically — but as of v4.1.3 the
// generated MainActivity has no call to it, and without it requestPermission
// crashes at runtime ("lateinit property requestPermission has not been
// initialized"). This plugin adds the registration to MainActivity.kt so it
// survives every `expo prebuild`.
// ---------------------------------------------------------------------------

const { withMainActivity } = require("@expo/config-plugins");

const IMPORT_LINE = "import expo.modules.ReactActivityDelegateWrapper";
const IMPORT_ADD = "import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate";
const CALL = "HealthConnectPermissionDelegate.setPermissionDelegate(this)";

module.exports = function withHealthConnectDelegate(config) {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes(CALL)) {
      return config; // already patched
    }

    if (!contents.includes(IMPORT_ADD)) {
      contents = contents.replace(IMPORT_LINE, `${IMPORT_LINE}\n${IMPORT_ADD}`);
    }

    // Register the launcher inside onCreate, before the activity is STARTED.
    const anchor = "super.onCreate(null)";
    if (!contents.includes(anchor)) {
      throw new Error("withHealthConnectDelegate: could not find MainActivity.onCreate anchor");
    }
    contents = contents.replace(anchor, `${anchor}\n    ${CALL}`);

    config.modResults.contents = contents;
    return config;
  });
};
