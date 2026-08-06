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
 *   - Right  : location name (bold, large) → address → datetime (HH:MM format) → coordinates
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

        const HEAD_F  = Math.max(30, Math.round(38.5 * scale)); // location name
        const BODY_F  = Math.max(22, Math.round(27.5 * scale)); // address lines
        const SMALL_F = Math.max(20, Math.round(26 * scale)); // datetime + coords
        const LINE_H  = Math.round(BODY_F * 1.65);

        // ── Canvas setup ─────────────────────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.width  = photoW;
        canvas.height = photoH + FOOTER;
        const ctx = canvas.getContext('2d')!;

        // 1. Original photo
        ctx.drawImage(img, 0, 0, photoW, photoH);

        // 2. Footer background — black semi-transparent
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(0, photoH, photoW, FOOTER);

        // ── 3×3 OSM tile grid ─────────────────────────────────────────────
        const ZOOM = 15;
        const TILE = 256;

        const tXFloat = ((lng + 180) / 360) * Math.pow(2, ZOOM);
        const latRad  = (lat * Math.PI) / 180;
        const tYFloat =
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
          Math.pow(2, ZOOM);

        const tX = Math.floor(tXFloat);
        const tY = Math.floor(tYFloat);
        const offX = (tXFloat - tX) * TILE;
        const offY = (tYFloat - tY) * TILE;

        const mc  = document.createElement('canvas');
        mc.width  = TILE * 3;
        mc.height = TILE * 3;
        const mctx = mc.getContext('2d')!;
        mctx.fillStyle = '#c8d8b0';
        mctx.fillRect(0, 0, mc.width, mc.height);

        await Promise.all(
          ([-1, 0, 1] as const).flatMap((dy) =>
            ([-1, 0, 1] as const).map(
              (dx) =>
                new Promise<void>((res) => {
                  const t = new Image();
                  t.crossOrigin = 'anonymous';
                  t.onload = () => {
                    mctx.drawImage(t, (dx + 1) * TILE, (dy + 1) * TILE);
                    t.src = '';
                    res();
                  };
                  t.onerror = () => res();
                  t.src = `https://tile.openstreetmap.org/${ZOOM}/${tX + dx}/${tY + dy}.png`;
                })
            )
          )
        );

        const coordPx = TILE + offX;
        const coordPy = TILE + offY;
        const cropX   = Math.max(0, Math.min(mc.width  - MAP_SZ, coordPx - MAP_SZ / 2));
        const cropY   = Math.max(0, Math.min(mc.height - MAP_SZ, coordPy - MAP_SZ / 2));

        const mapDX = PAD;
        const mapDY = photoH + PAD;

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(mapDX, mapDY, MAP_SZ, MAP_SZ, Math.max(4, Math.round(6 * scale)));
        ctx.clip();
        ctx.drawImage(mc, cropX, cropY, MAP_SZ, MAP_SZ, mapDX, mapDY, MAP_SZ, MAP_SZ);
        ctx.restore();

        mc.width = 0;
        mc.height = 0;

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

        const attrF   = Math.max(9, Math.round(10 * scale));
        const attrTxt = '© OpenStreetMap contributors';
        ctx.font      = `${attrF}px sans-serif`;
        const attrW  = ctx.measureText(attrTxt).width;
        const attrH  = attrF + 4;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillRect(mapDX + 2, mapDY + MAP_SZ - attrH - 2, attrW + 6, attrH);
        ctx.fillStyle = '#222222';
        ctx.fillText(attrTxt, mapDX + 5, mapDY + MAP_SZ - 3);

        // ── Text info (right of map) ──────────────────────────────────────
        const textX    = mapDX + MAP_SZ + Math.round(16 * scale);
        const textMaxW = photoW - textX - PAD;

        const parts     = address.split(',').map((s) => s.trim()).filter(Boolean);
        const locName   = parts.slice(0, 2).join(', ') || address;
        const locDetail = parts.slice(2).join(', ');

        let ty = photoH + PAD + HEAD_F;

        // ① Location name
        ctx.fillStyle = '#ffffff';
        let fittedHeadF = HEAD_F;
        ctx.font = `bold ${fittedHeadF}px sans-serif`;
        while (ctx.measureText(locName).width > textMaxW && fittedHeadF > Math.round(HEAD_F * 0.5)) {
          fittedHeadF -= 1;
          ctx.font = `bold ${fittedHeadF}px sans-serif`;
        }
        ctx.fillText(locName, textX, ty);
        ty += Math.round(fittedHeadF * 1.35);

        // ② Detail address
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

        // ③ Date & time — format with colon (HH:MM)
        ctx.fillStyle = '#94a3b8';
        ctx.font      = `${SMALL_F}px sans-serif`;
        const dateObj = new Date(timestamp);
        const datePart = dateObj.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
        const hh = String(dateObj.getHours()).padStart(2, '0');
        const mm = String(dateObj.getMinutes()).padStart(2, '0');
        const dateStr = `${datePart}, ${hh}:${mm}`;
        ctx.fillText(`⏱  ${dateStr}`, textX, ty);
        ty += Math.round(SMALL_F * 1.75);

        // ④ Coordinates
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
            img.src = '';
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-black/[0.08] dark:border-white/[0.1] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Ambil Foto Profil</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 flex flex-col items-center justify-center gap-4 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <RefreshCw className="w-7 h-7 text-[#0071e3] dark:text-[#2997ff] animate-spin" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 text-center">
                {statusMessage}
              </p>
            </div>
          ) : streamActive ? (
            <div className="relative w-full aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-sm">
              <video
                ref={videoRef}
                className="w-full h-full object-cover transform -scale-x-100"
                playsInline
                autoPlay
              />
              <div className="absolute top-3 left-3 bg-black/60 text-white text-[11px] font-medium px-3 py-1 rounded-full backdrop-blur-md flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Kamera Depan Aktif
              </div>
            </div>
          ) : (
            <div className="w-full p-6 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center text-center gap-3 bg-[#f5f5f7]/60 dark:bg-[#2c2c2e]/40">
              {cameraError && (
                <div className="text-amber-700 dark:text-amber-400 text-xs flex items-center gap-1.5 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              )}
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Pilih foto dari galeri HP atau ambil foto menggunakan kamera.
              </p>
              <label className="cursor-pointer bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#2997ff] dark:hover:bg-[#0071e3] text-white px-4 py-2 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95">
                <Upload className="w-3.5 h-3.5" />
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
        <div className="p-4 px-6 border-t border-black/[0.06] dark:border-white/[0.08] bg-[#f5f5f7]/50 dark:bg-[#1c1c1e] flex items-center justify-between gap-3">
          {streamActive ? (
            <>
              <label className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Upload galeri
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>

              <button
                onClick={handleCapture}
                disabled={loading}
                className="bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#2997ff] dark:hover:bg-[#0071e3] text-white font-medium px-5 py-2 rounded-full shadow-sm flex items-center gap-1.5 text-xs transition-all active:scale-95"
              >
                <Camera className="w-3.5 h-3.5" />
                Jepret Foto
              </button>
            </>
          ) : (
            <button
              onClick={startCamera}
              className="w-full py-2.5 text-xs font-medium text-[#0071e3] dark:text-[#2997ff] hover:bg-[#0071e3]/10 rounded-full transition-all border border-[#0071e3]/20 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Coba Ulang Akses Kamera
            </button>
          )}
        </div>
      </div>
    </div>
  );
}