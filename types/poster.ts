export type PosterType = "poster" | "graffiti" | "text" | "image" | "image_text";

export type StapleMark = {
  angle: number;
  y: number;
};

export type Poster = {
  id: string;
  type: PosterType;
  text: string | null;
  image_url: string | null;
  color: string | null;
  contact: string | null;
  angle: number;
  y: number;
  width: number;
  height: number;
  staples: StapleMark[] | null;
  created_at: string;
};

export type PosterDraft = {
  type: PosterType;
  text: string;
  imageFile: File | null;
  existingImageUrl?: string | null;
  color: string;
  contact: string;
  width: number;
  height: number;
};

export type PendingPoster = {
  type: PosterType;
  text: string | null;
  image_url: string | null;
  color: string | null;
  contact: string | null;
  width: number;
  height: number;
};

export type PosterInsert = PendingPoster & {
  angle: number;
  y: number;
  staples?: StapleMark[] | null;
};
