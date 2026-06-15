// web-ext configuration. Keeps development-only files out of the built
// package that gets uploaded to addons.mozilla.org.
module.exports = {
  ignoreFiles: [
    "dev-run.ps1",          // local dev launcher, not part of the extension
    "web-ext-config.cjs",   // this file
    ".ff-dev-profile/**",   // persistent dev profile
    ".claude/**",           // editor/tooling config
    "web-ext-artifacts/**", // build output
    "README.md",            // ships separately on the AMO listing page

    // NOTE: sidebar/local-backend.js STAYS in the build. It's only used when
    // the page runs without an extension runtime (website preview); inside
    // the real extension, sidebar.js never invokes it. But sidebar.html has
    // a <script src="local-backend.js"> tag, and excluding the file would
    // cause a console error from the missing script.
  ],
};
