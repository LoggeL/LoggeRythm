type SluggablePlaylist = {
  id: string | number;
  name: string;
};

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function playlistPath(playlist: SluggablePlaylist) {
  const slug = slugify(playlist.name);
  return `/playlist/${encodeURIComponent(String(playlist.id))}${slug ? `-${slug}` : ""}`;
}

export function playlistIdFromParam(param: string) {
  return decodeURIComponent(param).split("-")[0] || param;
}
