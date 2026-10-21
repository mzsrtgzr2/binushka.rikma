/**
 * Images uploaded from the newsletter editor.
 *
 * The work is done by the shared backoffice uploader; this only pins the
 * folder, so a path that an already-sent issue points at keeps its meaning.
 */

import { MediaError, folderFor as adminFolderFor, prepareUpload as adminPrepareUpload } from '../admin/media.mjs';

const SECTION = 'newsletter';

export { MediaError };

export function folderFor(date = new Date()) {
  return adminFolderFor(SECTION, date);
}

export function prepareUpload(upload, options = {}) {
  return adminPrepareUpload(upload, { ...options, section: SECTION });
}
