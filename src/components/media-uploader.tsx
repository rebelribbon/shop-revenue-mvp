"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import {
  finishMediaUploadAction,
  prepareMediaUploadAction,
} from "@/server/actions/job-media";

type Tag = "before" | "after" | "issue" | "quote" | "other";
type MediaPurpose = "general" | "intake" | "finding" | "walkaround";
const TAGS: [Tag, string][] = [
  ["before", "Before"],
  ["after", "After"],
  ["issue", "Found an issue"],
  ["quote", "For the quote"],
  ["other", "Other"],
];

// Photos are shrunk on the phone (max 2000px JPEG) so uploads are quick on a
// job site; videos are limited to about a minute.
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.82),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
const videoSeconds = (file: File) =>
  new Promise<number>((resolve) => {
    const v = d¶»§q«^