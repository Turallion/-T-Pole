import { isSupabaseConfigured, posterBucket, supabase } from "@/lib/supabase";
import type { Poster, PosterInsert, StapleMark } from "@/types/poster";

const LOCAL_POSTERS_KEY = "telephone-pole-message-board:posters";
const isProduction = process.env.NODE_ENV === "production";
const MAX_UPLOAD_IMAGE_EDGE = 1400;

export async function fetchPosters(): Promise<Poster[]> {
  if (!isSupabaseConfigured || !supabase) {
    if (isProduction) {
      console.warn("Supabase env variables are missing. The app is running in local-only mode.");
    }

    return readLocalPosters();
  }

  try {
    const { data, error } = await supabase
      .from("posters")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase posters fetch failed.", error.message);
      return readLocalPosters();
    }

    return (data ?? []).map(normalizePoster);
  } catch (error) {
    console.warn("Supabase posters fetch failed, using local posters.", error);
    return readLocalPosters();
  }
}

export async function createPoster(input: PosterInsert): Promise<Poster> {
  if (!isSupabaseConfigured || !supabase) {
    if (isProduction) {
      throw new Error("Supabase is not connected. Check Vercel environment variables and redeploy.");
    }

    return createLocalPoster(input);
  }

  try {
    const { data, error } = await supabase
      .from("posters")
      .insert(input)
      .select("*")
      .single();

    if (error) {
      if (isProduction) {
        throw new Error(`Supabase insert failed: ${error.message}`);
      }

      console.warn("Supabase poster create failed, saving locally.", error.message);
      return createLocalPoster(input);
    }

    return normalizePoster(data);
  } catch (error) {
    if (isProduction) {
      throw error instanceof Error ? error : new Error("Supabase insert failed.");
    }

    console.warn("Supabase poster create failed, saving locally.", error);
    return createLocalPoster(input);
  }
}

export async function deletePoster(posterId: string, adminPassword: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    writeLocalPosters(readLocalPosters().filter((poster) => poster.id !== posterId));
    return;
  }

  await runAdminDelete(adminPassword, posterId);
}

export async function clearPosters(adminPassword: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    writeLocalPosters([]);
    return;
  }

  await runAdminDelete(adminPassword);
}

export async function uploadPosterImage(file: File): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    if (isProduction) {
      throw new Error("Supabase storage is not connected. Check Vercel environment variables and redeploy.");
    }

    return compressImageAsDataUrl(file);
  }

  try {
    const uploadImage = await prepareImageForUpload(file);
    const path = `${crypto.randomUUID()}.${uploadImage.extension}`;
    const { error } = await supabase.storage
      .from(posterBucket)
      .upload(path, uploadImage.body, {
        cacheControl: "31536000",
        contentType: uploadImage.contentType,
        upsert: false
      });

    if (error) {
      if (isProduction) {
        throw new Error(`Supabase image upload failed: ${error.message}`);
      }

      console.warn("Supabase image upload failed, using local data URL.", error.message);
      return compressImageAsDataUrl(file);
    }

    const { data } = supabase.storage.from(posterBucket).getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    if (isProduction) {
      throw error instanceof Error ? error : new Error("Supabase image upload failed.");
    }

    console.warn("Supabase image upload failed, using local data URL.", error);
    return compressImageAsDataUrl(file);
  }
}

async function prepareImageForUpload(
  file: File
): Promise<{ body: Blob | File; extension: string; contentType: string }> {
  if (!file.type.startsWith("image/")) {
    return {
      body: file,
      extension: getFileExtension(file),
      contentType: file.type || "application/octet-stream"
    };
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(file);
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_UPLOAD_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not prepare image canvas.");
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const webpBlob = await canvasToBlob(canvas, "image/webp", 0.86);
    if (webpBlob) {
      return { body: webpBlob, extension: "webp", contentType: "image/webp" };
    }

    const pngBlob = await canvasToBlob(canvas, "image/png", 0.92);
    if (pngBlob) {
      return { body: pngBlob, extension: "png", contentType: "image/png" };
    }
  } catch (error) {
    console.warn("Could not optimize image before upload, using original file.", error);
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return {
    body: file,
    extension: getFileExtension(file),
    contentType: file.type || "application/octet-stream"
  };
}

function getFileExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && extension.length <= 8 ? extension : "png";
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function createLocalPoster(input: PosterInsert): Promise<Poster> {
  const poster = normalizePoster({
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...input
  });
  const posters = await compactLocalPosters([...readLocalPosters(), poster]);
  writeLocalPosters(posters);
  return poster;
}

function readLocalPosters(): Poster[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(LOCAL_POSTERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Poster[];
    return parsed.map(normalizePoster);
  } catch {
    localStorage.removeItem(LOCAL_POSTERS_KEY);
    return [];
  }
}

async function runAdminDelete(adminPassword: string, posterId?: string) {
  const query = posterId ? `?id=${encodeURIComponent(posterId)}` : "";
  const response = await fetch(`/api/admin/posters${query}`, {
    method: "DELETE",
    headers: {
      "x-admin-password": adminPassword
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not delete posters.");
  }
}

function normalizePoster(value: Omit<Poster, "staples"> & { staples?: unknown }): Poster {
  return {
    ...value,
    staples: normalizeStaples(value.staples)
  };
}

function normalizeStaples(value: unknown): StapleMark[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const staples = value
    .map((staple) => {
      if (
        typeof staple === "object" &&
        staple !== null &&
        "angle" in staple &&
        "y" in staple &&
        typeof staple.angle === "number" &&
        typeof staple.y === "number"
      ) {
        return {
          angle: staple.angle,
          y: staple.y
        };
      }

      return null;
    })
    .filter((staple): staple is StapleMark => Boolean(staple));

  return staples;
}

async function compressImageAsDataUrl(file: File): Promise<string> {
  const source = await readFileAsDataUrl(file);
  return compressDataUrl(source, 760, 0.78);
}

async function compactLocalPosters(posters: Poster[]): Promise<Poster[]> {
  const compacted = await Promise.all(
    posters.map(async (poster) => {
      if (!poster.image_url?.startsWith("data:image/") || poster.image_url.length < 180_000) {
        return poster;
      }

      try {
        return {
          ...poster,
          image_url: await compressDataUrl(poster.image_url, 620, 0.72)
        };
      } catch {
        return poster;
      }
    })
  );

  return compacted;
}

async function compressDataUrl(source: string, maxSize: number, quality: number): Promise<string> {
  const image = await loadImage(source);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return source;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const webp = canvas.toDataURL("image/webp", quality);
  return webp.length < source.length ? webp : source;
}

function writeLocalPosters(posters: Poster[]) {
  try {
    localStorage.setItem(LOCAL_POSTERS_KEY, JSON.stringify(posters));
    return;
  } catch (error) {
    const isQuotaError =
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

    if (!isQuotaError || posters.length <= 1) {
      throw error;
    }

    localStorage.setItem(LOCAL_POSTERS_KEY, JSON.stringify(posters.slice(-12)));
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not process image file."));
    image.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}
