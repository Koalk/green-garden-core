// SPDX-License-Identifier: AGPL-3.0-only
// Rules of the no-network guard, split out so they can be tested.
const mods = "(?:node:)?(?:http|https|http2|net|tls|dgram|dns)";
const calls = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  new RegExp(`from\\s+["']${mods}["']`),
  new RegExp(`require\\(\\s*["']${mods}["']\\s*\\)`),
];
const remoteUrl = /https?:\/\/(?!localhost|127\.0\.0\.1)/;
/** A test file that only holds saved URL strings as fixtures opts out of the URL rule with this line. */
export const FIXTURE_URLS = "// check-no-network: fixture-urls";

/** Lines (1-based number and text) of a test file's source that use the network. */
export function findNetworkUse(source) {
  const allowUrls = source.split("\n").some((l) => l.trim() === FIXTURE_URLS);
  const hits = [];
  source.split("\n").forEach((line, i) => {
    if (calls.some((re) => re.test(line)) || (!allowUrls && remoteUrl.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  });
  return hits;
}
