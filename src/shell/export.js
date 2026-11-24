// Hand an export to the device: the share sheet where it can take files
// (iPad: Save to Files, straight into a vault folder), downloads elsewhere.

/** @param {File[]} files */
export async function deliver(files) {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Fall through to downloads when sharing fails for another reason.
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = Object.assign(document.createElement("a"), { href: url, download: file.name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "downloaded";
}
