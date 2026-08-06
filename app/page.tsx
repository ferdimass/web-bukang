'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import CameraModal from '@/components/CameraModal';
import { supabase } from '@/lib/supabaseClient';
import { getProdiByNRP } from '@/lib/utils';
import { Search, UserCheck, Camera, Save, MapPin, CheckCircle2, AlertCircle, RefreshCw, Sparkles, Building2, Heart, MessageSquare } from 'lucide-react';

// Dynamic import LeafletMap to prevent SSR window reference error
const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-48 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse flex items-center justify-center text-xs text-slate-400">
      Memuat peta...
    </div>
  ),
});


export default function StudentFormPage() {
  const [nrp, setNrp] = useState('');
  const [searchingNrp, setSearchingNrp] = useState(false);
  const [nrpError, setNrpError] = useState<string | null>(null);
  const [masterMahasiswa, setMasterMahasiswa] = useState<{ nrp: string; nama_lengkap: string } | null>(null);

  // Form Fields
  const [prodi, setProdi] = useState('');
  const [asalDaerah, setAsalDaerah] = useState('');
  const [hobi, setHobi] = useState('');
  const [firstImpression, setFirstImpression] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [fotoPreview, setFotoPreview] = useState('');
  const [geotagLat, setGeotagLat] = useState<number | null>(null);
  const [geotagLng, setGeotagLng] = useState<number | null>(null);
  const [geotagAddress, setGeotagAddress] = useState('');
  const [geotagTimestamp, setGeotagTimestamp] = useState('');
  const [statusLengkap, setStatusLengkap] = useState('Belum Lengkap');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // UI state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Check NRP against master table & saved entries
  const handleNrpSearch = async (targetNrp: string) => {
    const clean = targetNrp.trim();
    setNrp(clean);
    setNrpError(null);
    setSaveSuccess(false);

    if (clean.length !== 10 || !/^\d{10}$/.test(clean)) {
      setMasterMahasiswa(null);
      if (clean.length > 0) {
        setNrpError('NRP harus berupa 10 digit angka (contoh: 5025251001)');
      }
      return;
    }

    setSearchingNrp(true);
    try {
      // 1. Search in master_mahasiswa
      const { data: masterData, error: masterErr } = await supabase
        .from('master_mahasiswa')
        .select('*')
        .eq('nrp', clean)
        .single();

      if (masterErr || !masterData) {
        setMasterMahasiswa(null);
        setNrpError('NRP tidak terdaftar dalam data master mahasiswa. Hubungi koordinator jika ini keliru.');
        setSearchingNrp(false);
        return;
      }

      setMasterMahasiswa(masterData);
      setNrpError(null);

      // Auto-detect Prodi from NRP prefix
      const autoProdi = getProdiByNRP(clean);
      if (!autoProdi) {
        setNrpError(
          'Kode NRP tidak dikenali. Kode awal NRP harus 502525 (Teknik Informatika), 505425 (Rekayasa Kecerdasan Artifisial), atau 505325 (Rekayasa Perangkat Lunak). Hubungi koordinator jika ini keliru.'
        );
        setMasterMahasiswa(null);
        setSearchingNrp(false);
        return;
      }

      // 2. Fetch existing entry if already filled before
      const { data: entryData, error: entryErr } = await supabase
        .from('buku_angkatan_entries')
        .select('*')
        .eq('nrp', clean)
        .maybeSingle();

      if (entryData) {
        // Always use autoProdi (detected from NRP) — do not allow override
        setProdi(autoProdi);
        setAsalDaerah(entryData.asal_daerah || '');
        setHobi(entryData.hobi || '');
        setFirstImpression(entryData.first_impression || '');
        setFotoUrl(entryData.foto_url || '');
        setFotoPreview(entryData.foto_url || '');
        setGeotagLat(entryData.geotag_lat ?? null);
        setGeotagLng(entryData.geotag_lng ?? null);
        setGeotagAddress(entryData.geotag_address || '');
        setGeotagTimestamp(entryData.geotag_timestamp || '');
        setStatusLengkap(entryData.status_lengkap || 'Belum Lengkap');
        setLastSavedTime(entryData.updated_at ? new Date(entryData.updated_at).toLocaleTimeString() : null);
      } else {
        // Reset form to defaults for new entry
        setProdi(autoProdi);
        setAsalDaerah('');
        setHobi('');
        setFirstImpression('');
        setFotoUrl('');
        setFotoPreview('');
        setGeotagLat(null);
        setGeotagLng(null);
        setGeotagAddress('');
        setGeotagTimestamp('');
        setStatusLengkap('Belum Lengkap');
        setLastSavedTime(null);
      }
    } catch (err: any) {
      console.error('Error searching NRP:', err);
      setNrpError('Terjadi kesalahan koneksi database.');
    } finally {
      setSearchingNrp(false);
    }
  };

  const handlePhotoCapture = (data: {
    photoBlob: Blob;
    previewUrl: string;
    lat: number;
    lng: number;
    address: string;
    timestamp: string;
  }) => {
    // Clean up previous blob URL from RAM if it was a blob URL
    setFotoPreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return data.previewUrl;
    });
    setFotoBlob(data.photoBlob);
    setGeotagLat(data.lat);
    setGeotagLng(data.lng);
    setGeotagAddress(data.address);
    setGeotagTimestamp(data.timestamp);
  };

  const handleSaveData = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!masterMahasiswa) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      let finalFotoUrl = fotoUrl;

      // 1. Upload photo to Supabase Storage if new blob exists
      if (fotoBlob) {
        const fileExt = 'jpg';
        const fileName = `${masterMahasiswa.nrp}_${Date.now()}.${fileExt}`;
        const filePath = `photos/${fileName}`;

        const { error: uploadErr } = await supabase.storage
          .from('foto-angkatan')
          .upload(filePath, fotoBlob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadErr) {
          console.error('Storage upload error:', uploadErr);
          throw new Error(`Gagal mengunggah foto: ${uploadErr.message}`);
        }

        const { data: publicUrlData } = supabase.storage
          .from('foto-angkatan')
          .getPublicUrl(filePath);

        finalFotoUrl = publicUrlData.publicUrl;
        setFotoUrl(finalFotoUrl);
      }

      // 2. Evaluate status_lengkap
      const isComplete =
        prodi.trim() !== '' &&
        asalDaerah.trim() !== '' &&
        hobi.trim() !== '' &&
        firstImpression.trim() !== '' &&
        finalFotoUrl.trim() !== '' &&
        geotagLat !== null &&
        geotagLng !== null &&
        geotagAddress.trim() !== '' &&
        geotagTimestamp.trim() !== '';

      const newStatus = isComplete ? 'Lengkap' : 'Belum Lengkap';
      setStatusLengkap(newStatus);

      // 3. Upsert into database
      const payload = {
        nrp: masterMahasiswa.nrp,
        nama_lengkap: masterMahasiswa.nama_lengkap,
        prodi,
        asal_daerah: asalDaerah,
        hobi,
        first_impression: firstImpression,
        foto_url: finalFotoUrl,
        geotag_lat: geotagLat,
        geotag_lng: geotagLng,
        geotag_address: geotagAddress,
        geotag_timestamp: geotagTimestamp || new Date().toISOString(),
        status_lengkap: newStatus,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('buku_angkatan_entries')
        .upsert(payload, { onConflict: 'nrp' });

      if (upsertErr) {
        throw new Error(upsertErr.message);
      }

      setSaveSuccess(true);
      setLastSavedTime(new Date().toLocaleTimeString());
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      console.error('Save data error:', err);
      setSaveError(err.message || 'Gagal menyimpan data.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-xl w-full mx-auto p-4 py-8 flex flex-col gap-6">
        {/* Banner Welcome */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex items-center gap-2 text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-4 h-4" />
            Halaman Pengisian Data
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Buku Angkatan</h1>
          <p className="text-indigo-100 text-sm leading-relaxed">
            Made by? Antigravity
          </p>
        </div>

        {/* Step 1: Input NRP */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 flex flex-col gap-4">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between">
            <span>Nomor Registrasi Pokok (NRP)</span>
            <span className="text-xs font-normal text-slate-400">10 Digit Angka</span>
          </label>

          <div className="relative">
            <input
              type="text"
              maxLength={10}
              placeholder="Contoh: 5025251001"
              value={nrp}
              onChange={(e) => handleNrpSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-lg tracking-wider focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
            />
            <Search className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
            {searchingNrp && (
              <RefreshCw className="w-5 h-5 absolute right-3.5 top-3.5 text-indigo-500 animate-spin" />
            )}
          </div>

          {nrpError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{nrpError}</span>
            </div>
          )}

          {masterMahasiswa && (
            <div className="p-4 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 block">
                    Mahasiswa Terverifikasi
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-base">
                    {masterMahasiswa.nama_lengkap}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span
                  className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                    statusLengkap === 'Lengkap'
                      ? 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {statusLengkap}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Form Pengisian */}
        {masterMahasiswa && (
          <form onSubmit={handleSaveData} className="flex flex-col gap-6 animate-fadeIn">
            {/* Form Fields Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 flex flex-col gap-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center gap-2">
                <span>Informasi Diri</span>
              </h2>

              {/* Nama Lengkap Read-Only */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Nama Lengkap</label>
                <input
                  type="text"
                  value={masterMahasiswa.nama_lengkap}
                  disabled
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium text-sm border border-slate-200 dark:border-slate-700 cursor-not-allowed"
                />
              </div>

              {/* Program Studi — Read-Only, auto-detected from NRP */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                  Program Studi
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={prodi}
                    readOnly
                    disabled
                    className="w-full pl-3.5 pr-24 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium cursor-not-allowed"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                    Otomatis dari NRP
                  </span>
                </div>
              </div>

              {/* Asal Daerah */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                  Asal Daerah / Kota asal
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Surabaya, Jawa Timur"
                  value={asalDaerah}
                  onChange={(e) => setAsalDaerah(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                />
              </div>

              {/* Hobi */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-indigo-500" />
                  Hobi / Minat
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Coding, Basket, Musik"
                  value={hobi}
                  onChange={(e) => setHobi(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                />
              </div>

              {/* First Impression */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                  First Impression / Pesan Singkat
                </label>
                <textarea
                  rows={3}
                  placeholder="Tuliskan kesan pertama Anda saat masuk kuliah atau pesan singkat untuk angkatan..."
                  value={firstImpression}
                  onChange={(e) => setFirstImpression(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium resize-y"
                />
              </div>
            </div>

            {/* Foto & Geotag Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Camera className="w-5 h-5 text-indigo-600" />
                  <span>Foto Profile & Geotag</span>
                </h2>

                <button
                  type="button"
                  onClick={() => setIsCameraOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-indigo-500/20 active:scale-95"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {fotoPreview ? 'Ambil Ulang Foto' : 'Ambil Foto Selfie'}
                </button>
              </div>

              {fotoPreview ? (
                <div className="flex flex-col gap-4">
                  {/* Image Preview — geotag sudah baked-in ke gambar, tidak perlu overlay CSS */}
                  <div className="relative w-full rounded-2xl overflow-hidden shadow-md bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <img src={fotoPreview} alt="Foto Profil" className="w-full h-auto object-cover" />
                    {geotagTimestamp && (
                      <div className="absolute top-2 left-2">
                        <span className="inline-flex items-center gap-1 bg-emerald-600/90 backdrop-blur text-white text-[10px] font-semibold px-2 py-1 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          Geotag Tertanam di Foto
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Leaflet Map Preview */}
                  {geotagLat !== null && geotagLng !== null && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                        Peta Lokasi Pengambilan Foto
                      </span>
                      <LeafletMap lat={geotagLat} lng={geotagLng} address={geotagAddress} />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => setIsCameraOpen(true)}
                  className="w-full py-10 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-800/40 cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors"
                >
                  <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-inner">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div className="text-center px-4">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Klik untuk Mengambil Foto Selfie
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Kamera depan akan aktif secara otomatis beserta pencatatan lokasi geotag.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Notification messages */}
            {saveSuccess && (
              <div className="p-4 rounded-2xl bg-emerald-500 text-white shadow-lg flex items-center gap-3 animate-fadeIn">
                <CheckCircle2 className="w-6 h-6 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Data Berhasil Tersimpan!</h4>
                  <p className="text-xs opacity-90">
                    Status kelengkapan: <span className="font-semibold underline">{statusLengkap}</span>
                  </p>
                </div>
              </div>
            )}

            {saveError && (
              <div className="p-4 rounded-2xl bg-rose-600 text-white shadow-lg flex items-center gap-3 animate-fadeIn">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <div>
                  <h4 className="font-bold text-sm">Gagal Menyimpan</h4>
                  <p className="text-xs opacity-90">{saveError}</p>
                </div>
              </div>
            )}

            {/* Floating / Sticky Save Bar */}
            <div className="sticky bottom-4 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {lastSavedTime ? (
                  <span>Tersimpan pukul {lastSavedTime}</span>
                ) : (
                  <span>Klik simpan untuk memperbarui data</span>
                )}
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Simpan Data
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </main>

      {/* Camera Capture Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handlePhotoCapture}
      />
    </div>
  );
}
