// File size limits (spec 13.9), in bytes. The one place these numbers live.
//   FILE_MAX     a file above this is refused (GitHub's hard per-file limit, 100 MB)
//   FILE_NOTE    above this the dashboard notes a slow upload and a slow download on phones (50 MB)
//   TOTAL_AMBER  the Files gauge turns amber (700 MB of attachments in all)
//   TOTAL_RED    the Files gauge turns red (900 MB)
export const FILE_MAX = 104857600, FILE_NOTE = 52428800, TOTAL_AMBER = 734003200, TOTAL_RED = 943718400;
