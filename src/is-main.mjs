import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// True when the module whose `import.meta.url` is given was started directly (`node src/build.mjs`) and not imported.
// Both paths go through the real file system first, so symlinks, junctions, forward slashes and drive-letter case
// (all of which differ on Windows) cannot make two names for the same file look different.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}
