"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FileImage, Paintbrush, PanelTop, Plus, X } from "lucide-react";
import type { PendingPoster, PosterDraft, PosterType } from "@/types/poster";

const paperSizes = [
  { label: "S", description: "Folded 1/2 A4", width: 1.42, height: 1.0 },
  { label: "L", description: "A4", width: 1.42, height: 2.0 }
];

const paperColors = ["#fff7ce", "#ffffff", "#ffd5d0", "#cdf6de", "#d8efff", "#f6e2ff"];
const DEFAULT_POSTER_TEXT = "Has anyone seen my stapler?";

type Props = {
  open: boolean;
  isSaving: boolean;
  initialPoster?: PendingPoster | null;
  onClose: () => void;
  onCreate: (draft: PosterDraft) => void;
};

export default function AddPosterModal({ open, isSaving, initialPoster, onClose, onCreate }: Props) {
  const [type, setType] = useState<PosterType>("poster");
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState(1.6);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [paperColor, setPaperColor] = useState(paperColors[0]);

  const isGraffiti = type === "graffiti";
  const selectedSize = isGraffiti
    ? getGraffitiDimensions(imageAspect)
    : paperSizes[Math.min(sizeIndex, paperSizes.length - 1)];
  const hasContact = contact.trim().length > 0;
  const hasContent = isGraffiti ? Boolean(imageFile || existingImageUrl) : text.trim().length > 0;
  const canSubmit = !isSaving && hasContact && hasContent;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!initialPoster) {
      setType("poster");
      setText(DEFAULT_POSTER_TEXT);
      setContact("");
      setImageFile(null);
      setExistingImageUrl(null);
      setPreviewUrl(null);
      setImageAspect(1.6);
      setSizeIndex(1);
      setPaperColor(paperColors[0]);
      return;
    }

    setType(initialPoster.type);
    setText(initialPoster.text ?? "");
    setContact(normalizeContactInput(initialPoster.contact ?? ""));
    setImageFile(null);
    setExistingImageUrl(initialPoster.image_url);
    setPreviewUrl(initialPoster.image_url);
    setImageAspect(initialPoster.width / initialPoster.height);
    setPaperColor(initialPoster.color ?? paperColors[0]);
    setSizeIndex(getClosestPaperSizeIndex(initialPoster.width, initialPoster.height));
  }, [initialPoster, open]);

  if (!open) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    onCreate({
      type,
      text: isGraffiti ? "" : text,
      imageFile,
      existingImageUrl,
      color: isGraffiti ? "#ffffff" : paperColor,
      contact: normalizeContactInput(contact),
      width: selectedSize.width,
      height: selectedSize.height
    });
  }

  function handleImageChange(file: File | null) {
    setImageFile(file);
    setExistingImageUrl(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!file) {
      setPreviewUrl(null);
      setImageAspect(1.6);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageAspect(image.naturalWidth / image.naturalHeight);
      }
    };
    image.src = objectUrl;
  }

  function handleTypeChange(nextType: PosterType) {
    setType(nextType);
    setSizeIndex(1);
  }

  function handleColorChange(color: string) {
    setPaperColor(color);
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-[#16201b]/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto border border-[#16201b] bg-[#fff8e8] p-4 shadow-[8px_8px_0_#16201b] sm:p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-[#1f6f55]">New placement</p>
            <h2 className="text-xl font-black text-[#16201b]">
              {initialPoster ? "Edit placement" : "Poster or graffiti"}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center border border-[#16201b]/20 bg-white/70 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#37b883]/30"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <TypeButton
            active={type === "poster"}
            icon={<PanelTop size={18} />}
            label="Poster"
            onClick={() => handleTypeChange("poster")}
          />
          <TypeButton
            active={type === "graffiti"}
            icon={<Paintbrush size={18} />}
            label="Graffiti"
            onClick={() => handleTypeChange("graffiti")}
          />
        </div>

        {!isGraffiti ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-[#16201b]">Poster text</span>
            <textarea
              className="h-28 w-full resize-none border border-[#16201b]/25 bg-white/85 p-3 text-base font-bold leading-snug text-[#16201b] outline-none transition focus:border-[#1f6f55] focus:ring-4 focus:ring-[#37b883]/25"
              maxLength={180}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder={DEFAULT_POSTER_TEXT}
            />
          </label>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-black text-[#16201b]">
            Contact Twitter @
          </span>
          <input
            className="h-11 w-full border border-[#16201b]/25 bg-white/85 px-3 text-base font-bold text-[#16201b] outline-none transition focus:border-[#1f6f55] focus:ring-4 focus:ring-[#37b883]/25"
            maxLength={32}
            required
            value={contact}
            onChange={(event) => setContact(normalizeContactInput(event.currentTarget.value))}
            placeholder="@yourhandle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        {isGraffiti ? (
          <div className="mt-4">
            {previewUrl ? (
              <div className="border border-[#16201b]/20 bg-white/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-[#16201b]">Transparent graphic</span>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 border border-[#16201b]/20 bg-white px-3 text-xs font-black transition hover:bg-[#ffe6ea]"
                    onClick={() => handleImageChange(null)}
                  >
                    <X size={15} />
                    Remove
                  </button>
                </div>
                <img
                  src={previewUrl}
                  alt=""
                  className="mt-3 h-44 w-full bg-[linear-gradient(45deg,#f1f5f2_25%,transparent_25%),linear-gradient(-45deg,#f1f5f2_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f2_75%),linear-gradient(-45deg,transparent_75%,#f1f5f2_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0] object-contain"
                />
              </div>
            ) : (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-dashed border-[#16201b]/40 bg-white/70 px-4 py-2 text-sm font-black text-[#16201b] transition hover:bg-white focus-within:ring-4 focus-within:ring-[#37b883]/25">
                <Plus size={17} strokeWidth={3} />
                Upload transparent graphic
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/webp,image/gif,image/svg+xml"
                  onChange={(event) => handleImageChange(event.currentTarget.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4">
              {previewUrl ? (
                <div className="border border-[#16201b]/20 bg-white/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black text-[#16201b]">Optional image</span>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 border border-[#16201b]/20 bg-white px-3 text-xs font-black transition hover:bg-[#ffe6ea]"
                      onClick={() => handleImageChange(null)}
                    >
                      <X size={15} />
                      Remove
                    </button>
                  </div>
                  <img
                    src={previewUrl}
                    alt=""
                    className="mt-3 h-44 w-full bg-[#f6f1e5] object-contain"
                  />
                </div>
              ) : (
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-dashed border-[#16201b]/40 bg-white/70 px-4 py-2 text-sm font-black text-[#16201b] transition hover:bg-white focus-within:ring-4 focus-within:ring-[#37b883]/25">
                  <Plus size={17} strokeWidth={3} />
                  Optionally add an image
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => handleImageChange(event.currentTarget.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
          </>
        )}

        {!isGraffiti ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <span className="mb-2 block text-sm font-black text-[#16201b]">
                Paper color
              </span>
              <div className="flex flex-wrap gap-2">
                {paperColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`size-9 border transition focus:outline-none focus:ring-4 focus:ring-[#37b883]/25 ${
                      color === paperColor
                        ? "border-[#16201b] shadow-[3px_3px_0_#16201b]"
                        : "border-[#16201b]/20"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorChange(color)}
                    aria-label={`Choose color ${color}`}
                  />
                ))}
              </div>
            </div>

            <div
              className="inline-grid w-fit border border-[#16201b]/20 bg-white/70 p-1"
              style={{ gridTemplateColumns: `repeat(${paperSizes.length}, minmax(0, 1fr))` }}
            >
              {paperSizes.map((size, index) => (
                <button
                  key={size.label}
                  type="button"
                  className={`h-11 min-w-14 px-3 text-sm font-black transition ${
                    index === sizeIndex
                      ? "bg-[#16201b] text-white"
                      : "text-[#16201b] hover:bg-[#cdf6de]"
                  }`}
                  onClick={() => setSizeIndex(index)}
                  title={size.description}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-[#16201b] bg-[#37b883] px-4 py-2 text-sm font-black text-[#07130f] shadow-[4px_4px_0_#16201b] transition hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#16201b] focus:outline-none focus:ring-4 focus:ring-[#37b883]/35 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={!canSubmit}
          >
            {isGraffiti ? <Paintbrush size={18} strokeWidth={3} /> : <FileImage size={18} strokeWidth={3} />}
            {isSaving ? "Saving" : initialPoster ? "Update" : isGraffiti ? "Make Graffiti" : "Make Poster"}
          </button>
        </div>
      </form>
    </div>
  );
}

type TypeButtonProps = {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function TypeButton({ active, icon, label, onClick }: TypeButtonProps) {
  return (
    <button
      type="button"
      className={`flex min-h-12 items-center justify-center gap-2 border px-2 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-[#37b883]/30 ${
        active
          ? "border-[#16201b] bg-[#ffcf57] text-[#16201b]"
          : "border-[#16201b]/20 bg-white/70 text-[#16201b] hover:bg-white"
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function getGraffitiDimensions(aspect: number) {
  const maxWidth = 2.0;
  const maxHeight = 1.35;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;

  if (safeAspect >= maxWidth / maxHeight) {
    return {
      width: maxWidth,
      height: maxWidth / safeAspect
    };
  }

  return {
    width: maxHeight * safeAspect,
    height: maxHeight
  };
}

function getClosestPaperSizeIndex(width: number, height: number) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  paperSizes.forEach((size, index) => {
    const distance = Math.abs(size.width - width) + Math.abs(size.height - height);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function normalizeContactInput(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}
