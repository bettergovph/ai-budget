/**
 * A leaderboard share image on a <canvas>, drawn at the format's native size
 * (1080×1350, 1080×1080, 1080×1920 or 1200×630) and scaled down by CSS.
 *
 * Fonts and portraits are awaited before the draw (missing portraits become
 * initials), stale draws are dropped when props change, and `onReady` hands
 * the page what it needs to download or share the PNG. The PNG is encoded
 * right after each draw so `toBlob()` resolves at once inside a click handler
 * (Safari only lets `navigator.share` run close to the tap).
 */

import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import type { JSX } from 'react';
import { SHARE_FORMATS, type BoardDef, type LeaderboardData, type ShareFormat } from '../lib/hgab-leaderboard';
import { renderShareCard, shareCardAlt, shareCardFileName } from '../lib/hgab-share-render';

export interface ShareCardApi {
  toBlob(): Promise<Blob>;
  fileName: string;
  width: number;
  height: number;
}

export interface HgabShareCardProps {
  data: LeaderboardData;
  board: BoardDef;
  format: ShareFormat;
  region?: string | null;
  /** The canvas is scaled by CSS (width:100%; height:auto); native size = format size. */
  className?: string;
  /** Called after every completed draw. */
  onReady?: (api: ShareCardApi) => void;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The share image could not be encoded.'))), 'image/png');
  });
}

export default function HgabShareCard({ data, board, format, region = null, className, onReady }: HgabShareCardProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** "WxH" of the last completed draw: keep it on screen while the next one loads. */
  const drawnSize = useRef<string | null>(null);
  const { width, height } = SHARE_FORMATS[format];
  const alt = useMemo(() => shareCardAlt(data, board, format, region), [data, board, format, region]);

  const fireReady = useEffectEvent((api: ShareCardApi) => onReady?.(api));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const stale = () => cancelled;
    // Plain placeholder while fonts and portraits load, unless a card of this size is already showing.
    const ctx = canvas.getContext('2d');
    if (ctx && drawnSize.current !== `${width}x${height}`) {
      ctx.fillStyle = '#f4f7fc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    renderShareCard(canvas, { data, board, format, region }, stale)
      .then((report) => {
        if (!report || stale()) return;
        drawnSize.current = `${width}x${height}`;
        // Encode once now; toBlob() hands out the same promise.
        const blob = canvasBlob(canvas);
        blob.catch(() => undefined);
        fireReady({
          toBlob: () => blob,
          fileName: shareCardFileName(board, format, region),
          width,
          height,
        });
      })
      .catch((err: unknown) => {
        console.error('HgabShareCard: draw failed', err);
      });
    return () => {
      // A newer draw (or unmount) makes this one stale.
      cancelled = true;
    };
  }, [data, board, format, region, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={alt}
      className={className}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    />
  );
}
