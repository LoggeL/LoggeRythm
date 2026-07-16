/** Product-facing album identity used by search and navigation. */
export interface AlbumCard {
  readonly id: string;
  readonly title: string;
  readonly artistName: string;
  readonly artworkUrl: string | null;
}
