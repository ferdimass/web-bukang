'use client';

import { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Upload, AlertCircle, X } from 'lucide-react';
import { compressImage } from '@/lib/utils';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (data: {
    photoBlob: Blob;
    previewUrl: string;
    lat: number;
    lng: number;
    address: string;
    timestamp: string;
  }) => void;
}

/**
 * Render geotag footer baked directly into the image via offscreen canvas.
 *
 * Layout (GPS Map Camera style):
 *   - Footer : full-width, black semi-transparent, NO border, NO watermark
 *   - Left   : 3×3 OSM tile grid cropped & centered on the coordinate + red pin
 *   - Right  : location name (bold, large) → address → datetime → coordinates
 *
 * All dimensions scale proportionally to photo width for consistent readability.
 */
async function renderGeotaggedBlob(
  photoBlob: Blob,
  lat: number,
  lng: number,
  address: string,
  timestamp: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(photoBlob);
    img.src = objectUrl;

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const photoW = img.naturalWidth;
        const photoH = img.naturalHeight;

        // ── Proportional layout (base: 1000px wide) ──────────────────────
        const scale   = photoW / 1000;
        const PAD     = Math.max(16, Math.round(20 * scale));
        const FOOTER  = Math.max(280, Math.round(420 * scale));
        const MAP_SZ  = FOOTER - PAD * 2; // square map thumbnail

        // Font sizes (2x from previous revision, per request)
        const HEAD_F  = Math.max(30, Math.round(42 * scale)); // location name
        const BODY_F  = Math.max(24, Math.round(30 * scale)); // address lines
        const SMALL_F = Math.max(20, Math.round(26 * scale)); // datetime + coords
        const LINE_H  = Math.round(BODY_F * 1.65);

        // ── Canvas setup ─────────────────────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.width  = photoW;
        canvas.height = photoH + FOOTER;
        const ctx = canvas.getContext('2d')!;

        // 1. Original photo
        ctx.drawImage(img, 0, 0, photoW, photoH);

        // 2. Footer background — black semi-transparent, NO blue border, NO watermark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(0, photoH, photoW, FOOTER);

        // ── 3×3 OSM tile grid (properly centered on coordinates) ─────────
        const ZOOM = 15;
        const TILE = 256;

        const tXFloat = ((lng + 180) / 360) * Math.pow(2, ZOOM);
        const latRad  = (lat * Math.PI) / 180;
        const tYFloat =
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
          Math.pow(2, ZOOM);

        const tX = Math.floor(tXFloat);
        const tY = Math.floor(tYFloat);
        // Sub-pixel offset of the coordinate within the center tile
        const offX = (tXFloat - tX) * TILE;
        const offY = (tYFloat - tY) * TILE;

        // Offscreen 3×3 composite canvas (768×768 at TILE=256)
        const mc  = document.createElement('canvas');
        mc.width  = TILE * 3;
        mc.height = TILE * 3;
        const mctx = mc.getContext('2d')!;
        mctx.fillStyle = '#c8d8b0'; // OSM-like green fallback
        mctx.fillRect(0, 0, mc.width, mc.height);

        // Load all 9 surrounding tiles in parallel (OSM supports CORS for browsers)
        await Promise.all(
          ([-1, 0, 1] as const).flatMap((dy) =>
            ([-1, 0, 1] as const).map(
              (dx) =>
                new Promise<void>((res) => {
                  const t = new Image();
                  t.crossOrigin = 'anonymous';
                  t.onload = () => {
                    mctx.drawImage(t, (dx + 1) * TILE, (dy + 1) * TILE);
                    t.src = ''; // release decoded bitmap immediately (WebKit memory)
                    res();
                  };
                  t.onerror = () => res(); // skip failed tiles gracefully
                  t.src = `https://tile.openstreetmap.org/${ZOOM}/${tX + dx}/${tY + dy}.png`;
                })
            )
          )
        );

        // Crop the 3×3 composite centered on the exact coordinate pixel
        const coordPx = TILE + offX;
        const coordPy = TILE + offY;
        const cropX   = Math.max(0, Math.min(mc.width  - MAP_SZ, coordPx - MAP_SZ / 2));
        const cropY   = Math.max(0, Math.min(mc.height - MAP_SZ, coordPy - MAP_SZ / 2));

        const mapDX = PAD;
        const mapDY = photoH + PAD;

        // Draw map thumbnail with rounded corners
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(mapDX, mapDY, MAP_SZ, MAP_SZ, Math.max(4, Math.round(6 * scale)));
        ctx.clip();
        ctx.drawImage(mc, cropX, cropY, MAP_SZ, MAP_SZ, mapDX, mapDY, MAP_SZ, MAP_SZ);
        ctx.restore();

        // Release the 768×768 composite canvas — no longer needed, and WebKit
        // reclaims canvas-backed memory faster when width/height is reset than
        // when left to garbage collection alone.
        mc.width = 0;
        mc.height = 0;

        // Red pin marker at the exact coordinate position inside the thumbnail
        const pinX = mapDX + (coordPx - cropX);
        const pinY = mapDY + (coordPy - cropY);
        const pinR = Math.max(5, Math.round(8 * scale));
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur  = Math.round(5 * scale);
        ctx.fillStyle   = '#ef4444';
        ctx.beginPath();
        ctx.arc(pinX, pinY, pinR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = Math.max(2, Math.round(2.5 * scale));
        ctx.stroke();
        ctx.restore();

        // OSM attribution — required by OSM license, shown inside map bottom strip
        const attrF   = Math.max(9, Math.round(10 * scale));
        const attrTxt = '© OpenStreetMap contributors';
        ctx.font      = `${attrF}px sans-serif`;
        const attrW  = ctx.measureText(attrTxt).width;
        const attrH  = attrF + 4;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillRect(mapDX + 2, mapDY + MAP_SZ - attrH - 2, attrW + 6, attrH);
        ctx.fillStyle = '#222222';
        ctx.fillText(attrTxt, mapDX + 5, mapDY + MAP_SZ - 3);

        // ── Text info (right of map) — GPS Map Camera hierarchy ──────────
        const textX    = mapDX + MAP_SZ + Math.round(16 * scale);
        const textMaxW = photoW - textX - PAD;

        // Split address: first 2 comma-parts = location name, rest = detail
        const parts     = address.split(',').map((s) => s.trim()).filter(Boolean);
        const locName   = parts.slice(0, 2).join(', ') || address;
        const locDetail = parts.slice(2).join(', ');

        let ty = photoH + PAD + HEAD_F;

        // ① Location name — white, bold, large
        ctx.fillStyle = '#ffffff';
        ctx.font      = `bold ${HEAD_F}px sans-serif`;
        let loc = locName;
        while (ctx.measureText(loc).width > textMaxW && loc.length > 4) {
          loc = loc.slice(0, -1);
        }
        if (loc.length < locName.length) loc += '…';
        ctx.fillText(loc, textX, ty);
        ty += Math.round(HEAD_F * 1.35);

        // ② Detail address — slate-300, up to 2 lines
        ctx.fillStyle = '#cbd5e1';
        ctx.font      = `${BODY_F}px sans-serif`;
        const addrWords = locDetail.split(' ');
        let curLine = '';
        let addrLineCount = 0;
        for (const word of addrWords) {
          const test = curLine ? curLine + ' ' + word : word;
          if (ctx.measureText(test).width > textMaxW && curLine) {
            ctx.fillText(curLine, textX, ty);
            ty += LINE_H;
            curLine = word;
            addrLineCount++;
            if (addrLineCount >= 2) {
              while (ctx.measureText(curLine + '…').width > textMaxW && curLine.length > 1) {
                curLine = curLine.slice(0, -1);
              }
              ctx.fillText(curLine + '…', textX, ty);
              ty += LINE_H;
              curLine = '';
              break;
            }
          } else {
            curLine = test;
          }
        }
        if (curLine) {
          ctx.fillText(curLine, textX, ty);
          ty += LINE_H;
        }

        ty += Math.round(6 * scale);

        // ③ Date & time — slate-400
        ctx.fillStyle = '#94a3b8';
        ctx.font      = `${SMALL_F}px sans-serif`;
        const dateStr = new Date(timestamp).toLocaleString('id-ID', {
          weekday: 'long',
          day:     '2-digit',
          month:   'long',
          year:    'numeric',
          hour:    '2-digit',
          minute:  '2-digit',
        });
        ctx.fillText(`⏱  ${dateStr}`, textX, ty);
        ty += Math.round(SMALL_F * 1.75);

        // ④ Coordinates — blue, monospace
        ctx.fillStyle = '#60a5fa';
        ctx.font      = `${SMALL_F}px monospace`;
        const coordStr =
          lat !== 0 || lng !== 0
            ? `${lat.toFixed(6)}°,  ${lng.toFixed(6)}°`
            : 'Koordinat tidak tersedia';
        ctx.fillText(coordStr, textX, ty);

        // ── Export JPEG ───────────────────────────────────────────────────
        canvas.toBlob(
          (blob) => {
            // Dispose the main canvas immediately after the blob is captured —
            // the blob already holds the encoded bytes, so the canvas backing
            // store is no longer needed.
            canvas.width = 0;
            canvas.height = 0;
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed'));
          },
          'image/jpeg',
          0.9
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
  });
}

export default function CameraModal({ isOpen, onClose, onCapture }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreamActive(true);
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setCameraError('Gagal mengakses kamera depan. Anda dapat mengunggah foto dari galeri.');
      setStreamActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    // Explicitly clear srcObject — stopping tracks alone doesn't always release
    // the decoded video frame buffer on WebKit/iOS Safari, which is a common
    // contributor to "low memory" canvas errors on repeated captures.
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  };

  const getLocationAndAddress = async (): Promise<{
    lat: number;
    lng: number;
    address: string;
    timestamp: string;
  }> => {
    const timestamp = new Date().toISOString();

    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ lat: 0, lng: 0, address: 'Lokasi tidak didukung oleh peramban ini', timestamp });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          let address = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { 'Accept-Language': 'id,en' } }
            );
            if (response.ok) {
              const data = await response.json();
              if (data?.display_name) address = data.display_name;
            }
          } catch (e) {
            console.error('Reverse geocoding error:', e);
          }

          resolve({ lat, lng, address, timestamp });
        },
        (error) => {
          console.warn('Geolocation error:', error);
          resolve({
            lat: 0,
            lng: 0,
            address: 'Izin lokasi tidak diberikan atau GPS tidak aktif',
            timestamp,
          });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const processPhotoBlob = async (rawFile: File) => {
    setLoading(true);
    setStatusMessage('Mengompres foto & merekam koordinat lokasi...');

    try {
      const compressedBlob = await compressImage(rawFile, 1000, 0.75);
      const locationData   = await getLocationAndAddress();

      setStatusMessage('Menggabungkan geotag ke dalam foto...');
      const geotaggedBlob = await renderGeotaggedBlob(
        compressedBlob,
        locationData.lat,
        locationData.lng,
        locationData.address,
        locationData.timestamp
      );

      const previewUrl = URL.createObjectURL(geotaggedBlob);

      onCapture({ photoBlob: geotaggedBlob, previewUrl, ...locationData });
      stopCamera();
      onClose();
    } catch (err: any) {
      console.error('Error processing photo:', err);
      const msg = String(err?.message || err || '');
      const looksLikeMemoryIssue = /memory|allocat/i.test(msg);
      alert(
        looksLikeMemoryIssue
          ? 'Memori perangkat penuh. Coba tutup aplikasi/tab lain lalu ulangi pengambilan foto.'
          : 'Terjadi kesalahan saat memproses foto. Silakan coba lagi.'
      );
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Stop the live camera stream now — the frame is already captured, so the
    // stream doesn't need to stay decoded in memory during the geotag
    // compositing pipeline (compression, reverse geocoding, 9 OSM tile loads,
    // canvas rendering). Keeping it alive that whole time was a major
    // contributor to the "low memory" errors on repeated captures.
    stopCamera();

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        await processPhotoBlob(file);
      },
      'image/jpeg',
      0.9
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processPhotoBlob(files[0]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Ambil Foto Profil</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 flex-1 flex flex-col items-center justify-center gap-4 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 text-center">
                {statusMessage}
              </p>
            </div>
          ) : streamActive ? (
            <div className="relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden shadow-md">
              <video
                ref={videoRef}
                className="w-full h-full object-cover transform -scale-x-100"
                playsInline
                autoPlay
              />
              <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-md flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Kamera Depan Aktif
              </div>
            </div>
          ) : (
            <div className="w-full p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex flex-col items-center text-center gap-3 bg-slate-50 dark:bg-slate-800/50">
              {cameraError && (
                <div className="text-amber-600 dark:text-amber-400 text-xs flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Pilih foto dari galeri HP atau ambil foto menggunakan kamera peramban.
              </p>
              <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 transition-all shadow-md active:scale-95">
                <Upload className="w-4 h-4" />
                Pilih Foto / Upload
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-3">
          {streamActive ? (
            <>
              <label className="cursor-pointer text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Upload dari galeri
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>

              <button
                onClick={handleCapture}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center gap-2 text-sm transition-all active:scale-95"
              >
                <Camera className="w-4 h-4" />
                Jepret Foto
              </button>
            </>
          ) : (
            <button
              onClick={startCamera}
              className="w-full py-2.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-all border border-indigo-200 dark:border-indigo-800 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Coba Ulang Akses Kamera
            </button>
          )}
        </div>
      </div>
    </div>
  );
}