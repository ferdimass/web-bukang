'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import CameraModal from '@/components/CameraModal';
import { supabase } from '@/lib/supabaseClient';
import { getProdiByNRP } from '@/lib/utils';
import { Search, UserCheck, Camera, Save, MapPin, CheckCircle2, AlertCircle, RefreshCw, Building2, Heart, MessageSquare } from 'lucide-react';

// Dynamic import LeafletMap to prevent SSR window reference error
const LeafletMap = dynamic(() => import('@/components/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-48 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse flex items-center justify-center text-xs text-slate-400">
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

  // Format time as HH:MM with colon
  const formatTimeStr = (isoOrDate: string | Date) => {
    const d = new Date(isoOrDate);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

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
      const { data: entryData } = await supabase
        .from('buku_angkatan_entries')
        .select('*')
        .eq('nrp', clean)
        .maybeSingle();

      if (entryData) {
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
        setLastSavedTime(entryData.updated_at ? formatTimeStr(entryData.updated_at) : null);
      } else {
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
      setLastSavedTime(formatTimeStr(new Date()));
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      console.error('Save data error:', err);
      setSaveError(err.message || 'Gagal menyimpan data.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000000] text-[#1d1d1f] dark:text-[#f5f5f7] flex flex-col font-sans transition-colors duration-200">
      <Navbar />

      <main className="flex-1 max-w-xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 flex flex-col gap-8">
        {/* Apple Style Hero Header */}
        <div className="text-center flex flex-col items-center gap-2 pt-2 pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Halaman Pengisian Data
          </span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Buku Angkatan.
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-normal max-w-sm leading-relaxed">
            Lengkapi data profil dan foto selfie Anda untuk tercatat dalam database angkatan.
          </p>
        </div>

        {/* Step 1: Input NRP Card */}
        <div className="apple-card rounded-3xl p-6 sm:p-7 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Nomor Registrasi Pokok (NRP)
            </label>
            <span className="text-xs text-slate-400 dark:text-slate-500">10 Digit</span>
          </div>

          <div className="relative">
            <input
              type="text"
              maxLength={10}
              placeholder="Contoh: 5025251001"
              value={nrp}
              onChange={(e) => handleNrpSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent focus:border-[#0071e3] dark:focus:border-[#2997ff] text-slate-900 dark:text-slate-100 font-mono text-lg tracking-wider focus:outline-none transition-all"
            />
            <Search className="w-5 h-5 absolute left-3.5 top-4 text-slate-400" />
            {searchingNrp && (
              <RefreshCw className="w-5 h-5 absolute right-3.5 top-4 text-[#0071e3] dark:text-[#2997ff] animate-spin" />
            )}
          </div>

          {nrpError && (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{nrpError}</span>
            </div>
          )}

          {masterMahasiswa && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 block">
                    Mahasiswa Terverifikasi
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    {masterMahasiswa.nama_lengkap}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-[11px] font-medium ${
                    statusLengkap === 'Lengkap'
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
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
          <form onSubmit={handleSaveData} className="flex flex-col gap-8 animate-fadeIn">
            {/* Form Fields Card */}
            <div className="apple-card rounded-3xl p-6 sm:p-7 shadow-sm flex flex-col gap-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 border-b border-black/[0.06] dark:border-white/[0.08] pb-3">
                Informasi Diri
              </h2>

              {/* Nama Lengkap Read-Only */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Nama Lengkap</label>
                <input
                  type="text"
                  value={masterMahasiswa.nama_lengkap}
                  disabled
                  className="w-full px-4 py-3 rounded-xl bg-slate-200/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-sm font-medium border border-transparent cursor-not-allowed"
                />
              </div>

              {/* Program Studi — Read-Only, auto-detected from NRP */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  Program Studi
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={prodi}
                    readOnly
                    disabled
                    className="w-full pl-4 pr-28 py-3 rounded-xl bg-slate-200/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 text-sm font-medium border border-transparent cursor-not-allowed"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium bg-slate-300/60 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                    Otomatis dari NRP
                  </span>
                </div>
              </div>

              {/* Asal Daerah */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  Asal Daerah / Kota asal
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Surabaya, Jawa Timur"
                  value={asalDaerah}
                  onChange={(e) => setAsalDaerah(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent focus:border-[#0071e3] dark:focus:border-[#2997ff] text-slate-900 dark:text-slate-100 text-sm focus:outline-none transition-all font-normal"
                />
              </div>

              {/* Hobi */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-slate-400" />
                  Hobi / Minat
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Coding, Basket, Musik"
                  value={hobi}
                  onChange={(e) => setHobi(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent focus:border-[#0071e3] dark:focus:border-[#2997ff] text-slate-900 dark:text-slate-100 text-sm focus:outline-none transition-all font-normal"
                />
              </div>

              {/* First Impression */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                  First Impression / Pesan Singkat
                </label>
                <textarea
                  rows={3}
                  placeholder="Tuliskan kesan pertama Anda saat masuk kuliah atau pesan singkat untuk angkatan..."
                  value={firstImpression}
                  onChange={(e) => setFirstImpression(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent focus:border-[#0071e3] dark:focus:border-[#2997ff] text-slate-900 dark:text-slate-100 text-sm focus:outline-none transition-all font-normal resize-y"
                />
              </div>
            </div>

            {/* Foto & Geotag Card */}
            <div className="apple-card rounded-3xl p-6 sm:p-7 shadow-sm flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08] pb-3">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Camera className="w-4 h-4 text-slate-500" />
                  <span>Foto Profile & Geotag</span>
                </h2>

                <button
                  type="button"
                  onClick={() => setIsCameraOpen(true)}
                  className="px-4 py-1.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#2997ff] dark:hover:bg-[#0071e3] text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {fotoPreview ? 'Ambil Ulang Foto' : 'Ambil Foto Selfie'}
                </button>
              </div>

              {fotoPreview ? (
                <div className="flex flex-col gap-4">
                  {/* Image Preview */}
                  <div className="relative w-full rounded-2xl overflow-hidden shadow-sm bg-black border border-black/[0.08] dark:border-white/[0.1]">
                    <img src={fotoPreview} alt="Foto Profil" className="w-full h-auto object-cover" />
                    {geotagTimestamp && (
                      <div className="absolute top-3 left-3">
                        <span className="inline-flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white text-[11px] font-medium px-3 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Geotag Tertanam
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Leaflet Map Preview */}
                  {geotagLat !== null && geotagLng !== null && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        Peta Lokasi Pengambilan Foto
                      </span>
                      <LeafletMap lat={geotagLat} lng={geotagLng} address={geotagAddress} />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => setIsCameraOpen(true)}
                  className="w-full py-12 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-3 bg-[#f5f5f7]/50 dark:bg-[#2c2c2e]/40 cursor-pointer hover:border-[#0071e3] dark:hover:border-[#2997ff] transition-all"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-200/60 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div className="text-center px-4">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      Klik untuk Mengambil Foto Selfie
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Kamera depan akan aktif secara otomatis beserta pencatatan lokasi geotag.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Notification messages */}
            {saveSuccess && (
              <div className="p-4 rounded-2xl bg-emerald-500 text-white shadow-sm flex items-center gap-3 animate-fadeIn">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Data Berhasil Tersimpan!</h4>
                  <p className="text-xs opacity-90">
                    Status kelengkapan: <span className="font-medium underline">{statusLengkap}</span>
                  </p>
                </div>
              </div>
            )}

            {saveError && (
              <div className="p-4 rounded-2xl bg-rose-600 text-white shadow-sm flex items-center gap-3 animate-fadeIn">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-sm">Gagal Menyimpan</h4>
                  <p className="text-xs opacity-90">{saveError}</p>
                </div>
              </div>
            )}

            {/* Floating / Sticky Save Bar */}
            <div className="sticky bottom-6 z-30 apple-glass p-3 px-5 rounded-full border border-black/[0.08] dark:border-white/[0.1] shadow-lg flex items-center justify-between gap-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 pl-1">
                {lastSavedTime ? (
                  <span>Tersimpan pukul {lastSavedTime}</span>
                ) : (
                  <span>Klik simpan untuk memperbarui data</span>
                )}
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-full bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#2997ff] dark:hover:bg-[#0071e3] text-white font-medium text-xs shadow-sm flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
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
