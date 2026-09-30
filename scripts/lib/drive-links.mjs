// Pulls the Drive file or folder ID out of a Google Drive, Docs, Sheets or Slides link.
//
//   https://docs.google.com/document/d/<id>/edit     also spreadsheets, presentation, forms, drawings
//   https://drive.google.com/file/d/<id>/view        any file
//   https://drive.google.com/drive/folders/<id>      also /drive/u/1/folders/<id>
//   https://drive.google.com/open?id=<id>            older links, and uc?id=
//
// A bare ID works too. Returns null for anything else.

const PATTERNS = [
  /\/(?:document|spreadsheets|presentation|forms|drawings|file)\/(?:u\/\d+\/)?d\/([\w-]{10,})/,
  /\/folders\/([\w-]{10,})/,
  /[?&]id=([\w-]{10,})/,
];

export function parseDriveLink(link) {
  const text = String(link ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return /^[\w-]{20,}$/.test(text) ? text : null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}
