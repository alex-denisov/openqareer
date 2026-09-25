import { useEffect, useState } from 'react';
import { apiFetch, getApiBaseUrl } from '../coach/apiClient';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function candidateMediaPath(mediaId: string): string {
  return `/api/v1/candidate/media/${encodeURIComponent(mediaId)}`;
}

/** A `data:` URL for the JSON form of a cached image, or `undefined` for anything else. */
export function mediaDataUrl(payload: unknown): string | undefined {
  const data = (payload as { data?: { mime?: unknown; base64?: unknown } } | null)?.data;
  if (typeof data?.mime !== 'string' || typeof data.base64 !== 'string') return undefined;
  if (!ALLOWED_MIME.has(data.mime) || !/^[A-Za-z0-9+/]+=*$/u.test(data.base64)) return undefined;
  return `data:${data.mime};base64,${data.base64}`;
}

async function loadDesktopMedia(mediaId: string): Promise<string | undefined> {
  const response = await apiFetch(candidateMediaPath(mediaId), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return undefined;
  return mediaDataUrl(await response.json());
}

/**
 * Where an `<img>` can read a cached LinkedIn photo or logo (B265 §4). The web
 * page reaches the endpoint with its cookie; the desktop app cannot — its
 * native bridge carries text only and `<img>` cannot send the bearer token —
 * so it loads the JSON form (B266). `undefined` means "show the initials".
 */
export function useCandidateMediaSrc(mediaId: string | undefined): string | undefined {
  const desktop = isTauriEnvironment();
  const [desktopSrc, setDesktopSrc] = useState<{ id: string; src?: string }>();
  useEffect(() => {
    if (!mediaId || !desktop) return undefined;
    let current = true;
    loadDesktopMedia(mediaId)
      .then((src) => current && setDesktopSrc({ id: mediaId, src }))
      .catch(() => current && setDesktopSrc({ id: mediaId }));
    return () => {
      current = false;
    };
  }, [mediaId, desktop]);
  if (!mediaId) return undefined;
  if (!desktop) return `${getApiBaseUrl()}${candidateMediaPath(mediaId)}`;
  return desktopSrc?.id === mediaId ? desktopSrc.src : undefined;
}
