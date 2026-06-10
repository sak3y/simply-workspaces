// web-ext configuration. Keeps development-only files out of the built
// package that gets uploaded to addons.mozilla.org.
module.exports = {
  ignoreFiles: [
    "dev-run.ps1",          // local dev launcher, not part of the extension
    "web-ext-config.cjs",   // this file
    ".ff-dev-profile",      // persistent dev profile
    ".claude",              // editor/tooling config
    "web-ext-artifacts",    // build output
  ],
};
