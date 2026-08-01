'use client';

import { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Check, Upload, AlertCircle, X, MapPin } from 'lucide-react';
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
 * Render geotag overlay baked directly into the image using an offscreen canvas.
 *
 * Layout: original photo on top, then a dark footer panel (~130px tall) containing:
 *   - Left column: OSM static map thumbnail (via tile URL)
 *   - Right column: pin icon + address, clock icon + formatted timestamp, coords
 *
 * The final canvas blob is returned — this is what gets uploaded to storage,
 * so the geotag is permanently embedded (baked-in) into the image.
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

      const photoW = img.naturalWidth;
      const photoH = img.naturalHeight;
      const FOOTER_H = 130;
      const MAP_W = 130;
      const PADDING = 12;

      const canvas = document.createElement('canvas');
      canvas.width = photoW;
      canvas.height = photoH + FOOTER_H;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // 1. Draw original photo
      ctx.drawImage(img, 0, 0, photoW, photoH);

      // 2. Draw footer background
      ctx.fillStyle = '#0f172a'; // slate-900
      ctx.fillRect(0, photoH, photoW, FOOTER_H);

      // 3. Draw subtle top border accent on footer
      ctx.fillStyle = '#6366f1'; // indigo-500
      ctx.fillRect(0, photoH, photoW, 2);

      // 4. Attempt to fetch & draw OSM static map thumbnail
      const zoom = 15;
      const tileSize = 256;
      // Convert lat/lng to tile XY
      const tileX = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
      const tileY = Math.floor(
        ((1 -
          Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
            Math.PI) /
          2) *
          Math.pow(2, zoom)
      );
      const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;

      let mapDrawn = false;
      try {
        // Fetch the tile as a blob to avoid CORS issues with drawImage on external URLs
        const tileResp = await fetch(tileUrl, {
          headers: { 'User-Agent': 'BukuAngkatan/1.0' },
        });
        if (tileResp.ok) {
          const tileBlob = await tileResp.blob();
          const tileObjectUrl = URL.createObjectURL(tileBlob);
          await new Promise<void>((res) => {
            const tileImg = new Image();
            tileImg.src = tileObjectUrl;
            tileImg.onload = () => {
              const mapY = photoH + PADDING;
              const mapH = FOOTER_H - PADDING * 2;
              // Draw map thumbnail
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(PADDING, mapY, MAP_W, mapH, 6);
              ctx.clip();
              ctx.drawImage(tileImg, PADDING, mapY, MAP_W, mapH);
              ctx.restore();
              // Pin marker overlay on map center
              const pinX = PADDING + MAP_W / 2;
              const pinY = mapY + mapH / 2;
              ctx.fillStyle = '#ef4444';
              ctx.beginPath();
              ctx.arc(pinX, pinY, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;
              ctx.stroke();
              URL.revokeObjectURL(tileObjectUrl);
              mapDrawn = true;
              res();
            };
            tileImg.onerror = () => {
              URL.revokeObjectURL(tileObjectUrl);
              res();
            };
          });
        }
      } catch {
        // Map tile fetch failed — skip map, still render text
      }

      if (!mapDrawn) {
        // Fallback: draw a placeholder gray box with map icon text
        const mapY = photoH + PADDING;
        const mapH = FOOTER_H - PADDING * 2;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(PADDING, mapY, MAP_W, mapH, 6);
        ctx.clip();
        ctx.fillStyle = '#1e293b'; // slate-800
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📍 Map', PADDING + MAP_W / 2, photoH + FOOTER_H / 2 + 4);
        ctx.textAlign = 'left';
      }

      // 5. Draw text info (right of map)
      const textX = PADDING + MAP_W + 12;
      const textMaxW = photoW - textX - PADDING;
      const lineH = 17;
      let textY = photoH + PADDING + 14;

      // Address (truncated to fit)
      ctx.fillStyle = '#f1f5f9'; // slate-100
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('📍', textX, textY);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#cbd5e1'; // slate-300
      // Word-wrap address across up to 3 lines
      const words = address.split(' ');
      let line = '';
      let lineCount = 0;
      for (const word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > textMaxW - 16 && line) {
          ctx.fillText(line, textX + 16, textY);
          textY += lineH;
          line = word;
          lineCount++;
          if (lineCount >= 3) {
            line += '...';
            break;
          }
        } else {
          line = testLine;
        }
      }
      if (line) {
        ctx.fillText(line, textX + 16, textY);
        textY += lineH;
      }

      textY += 4;

      // Timestamp
      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('🕐', textX, textY);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#94a3b8'; // slate-400
      const dateStr = new Date(timestamp).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      ctx.fillText(dateStr, textX + 16, textY);
      textY += lineH + 4;

      // Coordinates
      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('🌐', textX, textY);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#6366f1'; // indigo-400
      const coordStr =
        lat !== 0 || lng !== 0
          ? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          : 'Koordinat tidak tersedia';
      ctx.fillText(coordStr, textX + 16, textY);

      // 6. Watermark
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#475569'; // slate-600
      ctx.textAlign = 'right';
      ctx.fillText('Buku Angkatan 2026 • ITS', photoW - PADDING, photoH + FOOTER_H - 8);
      ctx.textAlign = 'left';

      // 7. Export as JPEG blob
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        },
        'image/jpeg',
        0.88
      );
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

  // Start camera stream when modal opens
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
          facingMode: 'user', // Default to front camera (selfie mode)
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
    setStreamActive(false);
  };

  const getLocationAndAddress = async (): Promise<{ lat: number; lng: number; address: string; timestamp: string }> => {
    const timestamp = new Date().toISOString();

    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({
          lat: 0,
          lng: 0,
          address: 'Lokasi tidak didukung oleh peramban ini',
          timestamp,
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          let address = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

          try {
            // Free Reverse Geocoding via Nominatim OpenStreetMap API
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              {
                headers: {
                  'Accept-Language': 'id,en',
                },
              }
            );

            if (response.ok) {
              const data = await response.json();
              if (data && data.display_name) {
                address = data.display_name;
              }
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
      // 1. Client-side compression
      const compressedBlob = await compressImage(rawFile, 1000, 0.75);

      // 2. Geolocation + Reverse Geocoding
      const locationData = await getLocationAndAddress();

      // 3. Bake geotag overlay into image using canvas compositing
      setStatusMessage('Menggabungkan geotag ke dalam foto...');
      const geotaggedBlob = await renderGeotaggedBlob(
        compressedBlob,
        locationData.lat,
        locationData.lng,
        locationData.address,
        locationData.timestamp
      );

      const previewUrl = URL.createObjectURL(geotaggedBlob);

      onCapture({
        photoBlob: geotaggedBlob,
        previewUrl,
        ...locationData,
      });

      stopCamera();
      onClose();
    } catch (err: any) {
      console.error('Error processing photo:', err);
      alert('Terjadi kesalahan saat memproses foto. Silakan coba lagi.');
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw video frame to canvas
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
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 text-center">{statusMessage}</p>
            </div>
          ) : streamActive ? (
            <div className="relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden shadow-md">
              <video ref={videoRef} className="w-full h-full object-cover transform -scale-x-100" playsInline autoPlay />
              <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-md flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
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
                <input type="file" accept="image/*" capture="user" onChange={handleFileUpload} className="hidden" />
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
