'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { supabase } from '@/lib/supabaseClient';
import { sanitizeFilename, compressImage } from '@/lib/utils';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Users,
  CheckCircle2,
  Clock,
  UserX,
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  FileArchive,
  Edit,
  RefreshCw,
  X,
  Camera,
  MapPin,
  Save,
  AlertCircle,
  Building2,
  Heart,
  MessageSquare
} from 'lucide-react';

interface StudentEntry {
  nrp: string;
  nama_lengkap: string;
  prodi?: string;
  asal_daerah?: string;
  hobi?: string;
  first_impression?: string;
  foto_url?: string;
  geotag_lat?: number;
  geotag_lng?: number;
  geotag_address?: string;
  geotag_timestamp?: string;
  status_lengkap: string;
  updated_at?: string;
}

const PRODI_OPTIONS = [
  'Teknik Informatika',
  'Rekayasa Kecerdasan Artifisial',
  'Rekayasa Perangkat Lunak',
];

export default function AdminDashboardPage() {
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  // Raw data from database
  const [masterList, setMasterList] = useState<{ nrp: string; nama_lengkap: string }[]>([]);
  const [entriesMap, setEntriesMap] = useState<Record<string, StudentEntry>>({});

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Semua');
  const [prodiFilter, setProdiFilter] = useState('Semua');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Export progress states
  const [exportingZip, setExportingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState<StudentEntry | null>(null);
  const [editProdi, setEditProdi] = useState('');
  const [editAsalDaerah, setEditAsalDaerah] = useState('');
  const [editHobi, setEditHobi] = useState('');
  const [editFirstImpression, setEditFirstImpression] = useState('');
  const [editFotoUrl, setEditFotoUrl] = useState('');
  const [editFotoBlob, setEditFotoBlob] = useState<Blob | null>(null);
  const [editFotoPreview, setEditFotoPreview] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push('/admin/login');
        return;
      }
      setLoadingSession(false);
      await fetchData();
    };

    checkAuthAndFetch();
  }, [router]);

  const fetchData = async () => {
    setLoadingData(true);
    try {
      // 1. Fetch master mahasiswa
      const { data: masters, error: masterErr } = await supabase
        .from('master_mahasiswa')
        .select('*')
        .order('nrp', { ascending: true });

      if (masterErr) throw masterErr;
      setMasterList(masters || []);

      // 2. Fetch student entries
      const { data: entries, error: entriesErr } = await supabase
        .from('buku_angkatan_entries')
        .select('*');

      if (entriesErr) throw entriesErr;

      const map: Record<string, StudentEntry> = {};
      (entries || []).forEach((item: StudentEntry) => {
        map[item.nrp] = item;
      });

      setEntriesMap(map);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  // Compute merged list of all master students with their entries
  const combinedList = masterList.map((m) => {
    const entry = entriesMap[m.nrp];
    if (entry) {
      return entry;
    }
    return {
      nrp: m.nrp,
      nama_lengkap: m.nama_lengkap,
      status_lengkap: 'Belum Mengisi',
    };
  });

  // Calculate statistics
  const totalMaster = masterList.length;
  const countLengkap = combinedList.filter((x) => x.status_lengkap === 'Lengkap').length;
  const countBelumLengkap = combinedList.filter((x) => x.status_lengkap === 'Belum Lengkap').length;
  const countBelumIsi = combinedList.filter((x) => x.status_lengkap === 'Belum Mengisi').length;

  // Filter & Search combined list
  const filteredList = combinedList.filter((item) => {
    // Status Filter
    if (statusFilter !== 'Semua') {
      if (statusFilter === 'Lengkap' && item.status_lengkap !== 'Lengkap') return false;
      if (statusFilter === 'Belum Lengkap' && item.status_lengkap !== 'Belum Lengkap') return false;
      if (statusFilter === 'Belum Mengisi' && item.status_lengkap !== 'Belum Mengisi') return false;
    }

    // Prodi Filter
    if (prodiFilter !== 'Semua') {
      if ((item.prodi || '') !== prodiFilter) return false;
    }

    // Search Query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchNrp = item.nrp.toLowerCase().includes(q);
      const matchNama = item.nama_lengkap.toLowerCase().includes(q);
      if (!matchNrp && !matchNama) return false;
    }

    return true;
  });

  // Excel Export Handler
  const handleExportExcel = () => {
    const excelData = combinedList.map((item) => {
      const sanitizedName = sanitizeFilename(item.nama_lengkap);
      const photoFileName = `${item.nrp}_${sanitizedName}.jpg`;

      return {
        'NRP': item.nrp,
        'Nama Lengkap': item.nama_lengkap,
        'Program Studi': item.prodi || '-',
        'Asal Daerah': item.asal_daerah || '-',
        'Hobi': item.hobi || '-',
        'First Impression': item.first_impression || '-',
        'Geotag Latitude': item.geotag_lat ?? '-',
        'Geotag Longitude': item.geotag_lng ?? '-',
        'Alamat Geotag': item.geotag_address || '-',
        'Timestamp Geotag': item.geotag_timestamp ? new Date(item.geotag_timestamp).toLocaleString('id-ID') : '-',
        'Status Lengkap': item.status_lengkap,
        'nama_file_foto': photoFileName,
        'Link Foto Storage': item.foto_url || '-',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Buku Angkatan');
    XLSX.writeFile(workbook, `Data_Buku_Angkatan_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ZIP Photo Export Handler
  const handleExportZip = async () => {
    const entriesWithPhotos = combinedList.filter((item) => item.foto_url && item.foto_url.trim() !== '');

    if (entriesWithPhotos.length === 0) {
      alert('Tidak ada foto yang tersedia untuk diexport.');
      return;
    }

    setExportingZip(true);
    setZipProgress(0);

    const zip = new JSZip();
    const folder = zip.folder('foto_mahasiswa');

    let processedCount = 0;

    for (const item of entriesWithPhotos) {
      try {
        const sanitizedName = sanitizeFilename(item.nama_lengkap);
        const fileName = `${item.nrp}_${sanitizedName}.jpg`;

        const response = await fetch(item.foto_url!);
        if (response.ok) {
          const blob = await response.blob();
          folder?.file(fileName, blob);
        }
      } catch (err) {
        console.error(`Gagal mengunduh foto ${item.nrp}:`, err);
      } finally {
        processedCount++;
        setZipProgress(Math.round((processedCount / entriesWithPhotos.length) * 100));
      }
    }

    const zipContent = await zip.generateAsync({ type: 'blob' });
    saveAs(zipContent, `Foto_Buku_Angkatan_${new Date().toISOString().slice(0, 10)}.zip`);
    setExportingZip(false);
  };

  // Open Edit Modal for a student
  const handleOpenEdit = (student: StudentEntry) => {
    setEditingStudent(student);
    setEditProdi(student.prodi || '');
    setEditAsalDaerah(student.asal_daerah || '');
    setEditHobi(student.hobi || '');
    setEditFirstImpression(student.first_impression || '');
    setEditFotoUrl(student.foto_url || '');
    setEditFotoPreview(student.foto_url || '');
    setEditFotoBlob(null);
    setEditError(null);
  };

  const handleAdminPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressed = await compressImage(file, 1000, 0.75);
      setEditFotoBlob(compressed);
      setEditFotoPreview(URL.createObjectURL(compressed));
    } catch (err) {
      console.error('Compress error:', err);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingStudent) return;

    setSavingEdit(true);
    setEditError(null);

    try {
      let finalUrl = editFotoUrl;

      if (editFotoBlob) {
        const fileExt = 'jpg';
        const fileName = `${editingStudent.nrp}_${Date.now()}.${fileExt}`;
        const filePath = `photos/${fileName}`;

        const { error: uploadErr } = await supabase.storage
          .from('foto-angkatan')
          .upload(filePath, editFotoBlob, { contentType: 'image/jpeg', upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: publicUrlData } = supabase.storage
          .from('foto-angkatan')
          .getPublicUrl(filePath);

        finalUrl = publicUrlData.publicUrl;
      }

      const isComplete =
        editProdi.trim() !== '' &&
        editAsalDaerah.trim() !== '' &&
        editHobi.trim() !== '' &&
        editFirstImpression.trim() !== '' &&
        finalUrl.trim() !== '';

      const newStatus = isComplete ? 'Lengkap' : 'Belum Lengkap';

      const payload = {
        nrp: editingStudent.nrp,
        nama_lengkap: editingStudent.nama_lengkap,
        prodi: editProdi,
        asal_daerah: editAsalDaerah,
        hobi: editHobi,
        first_impression: editFirstImpression,
        foto_url: finalUrl,
        geotag_lat: editingStudent.geotag_lat ?? null,
        geotag_lng: editingStudent.geotag_lng ?? null,
        geotag_address: editingStudent.geotag_address || '',
        geotag_timestamp: editingStudent.geotag_timestamp || new Date().toISOString(),
        status_lengkap: newStatus,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('buku_angkatan_entries')
        .upsert(payload, { onConflict: 'nrp' });

      if (upsertErr) throw upsertErr;

      setEditingStudent(null);
      await fetchData();
    } catch (err: any) {
      console.error('Save admin edit error:', err);
      setEditError(err.message || 'Gagal menyunting data.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (loadingSession || loadingData) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Memuat Dashboard Admin...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 py-8 flex flex-col gap-6">
        {/* Header & Export Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Dashboard Admin Buku Angkatan
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monitoring data pengisian, filter, edit, dan export data Excel/ZIP.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportExcel}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-2 shadow-md shadow-emerald-500/20 transition-all active:scale-95"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel (.xlsx)
            </button>

            <button
              onClick={handleExportZip}
              disabled={exportingZip}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-2 shadow-md shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50"
            >
              {exportingZip ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  ZIP ({zipProgress}%)
                </>
              ) : (
                <>
                  <FileArchive className="w-4 h-4" />
                  Export ZIP Foto
                </>
              )}
            </button>
          </div>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Total Master</span>
              <span className="text-2xl font-extrabold text-slate-900 dark:text-white">{totalMaster}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Sudah Lengkap</span>
              <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{countLengkap}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Belum Lengkap</span>
              <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{countBelumLengkap}</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <UserX className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">Sisa Belum Isi</span>
              <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">{countBelumIsi}</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-72">
            <input
              type="text"
              placeholder="Cari NRP atau Nama..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium outline-none"
              >
                <option value="Semua">Semua Status</option>
                <option value="Lengkap">Lengkap</option>
                <option value="Belum Lengkap">Belum Lengkap</option>
                <option value="Belum Mengisi">Belum Mengisi</option>
              </select>
            </div>

            {/* Prodi Filter */}
            <select
              value={prodiFilter}
              onChange={(e) => setProdiFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium outline-none"
            >
              <option value="Semua">Semua Prodi</option>
              {PRODI_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <span className="text-xs text-slate-400 font-medium ml-auto sm:ml-0">
              {filteredList.length} data ditampilkan
            </span>
          </div>
        </div>

        {/* Gallery Grid View */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredList.map((student) => {
            const hasPhoto = student.foto_url && student.foto_url.trim() !== '';

            return (
              <div
                key={student.nrp}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow group"
              >
                {/* Photo Thumbnail */}
                <div className="relative w-full aspect-[4/3] bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                  {hasPhoto ? (
                    <img
                      src={student.foto_url}
                      alt={student.nama_lengkap}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 gap-1">
                      <Camera className="w-8 h-8" />
                      <span className="text-[10px]">Belum Ada Foto</span>
                    </div>
                  )}

                  {/* Status Badge */}
                  <span
                    className={`absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-md shadow-sm ${
                      student.status_lengkap === 'Lengkap'
                        ? 'bg-emerald-500/90 text-white'
                        : student.status_lengkap === 'Belum Lengkap'
                        ? 'bg-amber-500/90 text-white'
                        : 'bg-rose-500/90 text-white'
                    }`}
                  >
                    {student.status_lengkap}
                  </span>
                </div>

                {/* Info Content */}
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 block">
                      {student.nrp}
                    </span>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                      {student.nama_lengkap}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                      {student.prodi || 'Prodi belum diisi'}
                    </p>
                  </div>

                  <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                    <p className="truncate">
                      <span className="font-semibold">Asal:</span> {student.asal_daerah || '-'}
                    </p>
                    <p className="truncate">
                      <span className="font-semibold">Hobi:</span> {student.hobi || '-'}
                    </p>
                    <p className="line-clamp-2 italic text-[11px] text-slate-500 mt-1">
                      "{student.first_impression || 'Belum ada pesan'}"
                    </p>
                  </div>

                  <button
                    onClick={() => handleOpenEdit(student)}
                    className="w-full py-2 rounded-xl bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/50 text-slate-700 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Sunting Data
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filteredList.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            Tidak ada data mahasiswa yang sesuai dengan filter atau kata kunci pencarian.
          </div>
        )}
      </main>

      {/* Edit Student Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Sunting Data Mahasiswa
                </h3>
                <p className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                  {editingStudent.nrp} - {editingStudent.nama_lengkap}
                </p>
              </div>
              <button
                onClick={() => setEditingStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
              {editError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              {/* Photo preview & upload */}
              <div className="flex flex-col items-center gap-3 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
                {editFotoPreview ? (
                  <img src={editFotoPreview} alt="Preview" className="w-32 h-24 object-cover rounded-xl shadow-md" />
                ) : (
                  <div className="w-32 h-24 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-400">
                    <Camera className="w-6 h-6" />
                  </div>
                )}

                <label className="cursor-pointer px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm">
                  <Camera className="w-3.5 h-3.5" />
                  Ganti Foto
                  <input type="file" accept="image/*" onChange={handleAdminPhotoUpload} className="hidden" />
                </label>
              </div>

              {/* Form inputs */}
              <div className="space-y-3">
                <div>
                  <label className="font-semibold block mb-1">Program Studi</label>
                  <select
                    value={editProdi}
                    onChange={(e) => setEditProdi(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-medium outline-none"
                  >
                    <option value="">-- Pilih Prodi --</option>
                    {PRODI_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold block mb-1">Asal Daerah</label>
                  <input
                    type="text"
                    value={editAsalDaerah}
                    onChange={(e) => setEditAsalDaerah(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-medium outline-none"
                  />
                </div>

                <div>
                  <label className="font-semibold block mb-1">Hobi</label>
                  <input
                    type="text"
                    value={editHobi}
                    onChange={(e) => setEditHobi(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-medium outline-none"
                  />
                </div>

                <div>
                  <label className="font-semibold block mb-1">First Impression</label>
                  <textarea
                    rows={3}
                    value={editFirstImpression}
                    onChange={(e) => setEditFirstImpression(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-medium outline-none resize-y"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900">
              <button
                onClick={() => setEditingStudent(null)}
                className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 font-semibold"
              >
                Batal
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 shadow-md shadow-indigo-500/20 disabled:opacity-50"
              >
                {savingEdit ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Simpan Perubahan
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
