// Builds the standardized TM.7 export filename, shared by the client download
// trigger and the API route's Content-Disposition header so every device
// (Desktop, iPhone, Android) produces an identical name.
//
// Format: `TM7-[SURNAME] [NAME].pdf` (e.g. `TM7-SMITH JOHN.pdf`).

// Strip characters that are illegal in filenames on Windows/macOS/Android but
// keep spaces so the SURNAME/NAME separation survives.
function sanitizePart(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\\/:*?"<>|]/g, "") // filesystem-reserved characters
    .replace(/\s+/g, " ") // collapse runs of whitespace
    .trim()
    .toUpperCase();
}

export function buildTm7Filename(
  lastName: string | undefined,
  firstName: string | undefined
): string {
  const surname = sanitizePart(lastName);
  const name = sanitizePart(firstName);
  const namePart = [surname, name].filter(Boolean).join(" ");
  return `TM7-${namePart || "form"}.pdf`;
}
