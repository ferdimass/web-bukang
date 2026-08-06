'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, Database } from 'lucide-react';

export default function AdminImportPage() {
  const [loadingSession, setLoadingSession] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<{ nrp: string; nama_lengkap: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push('/admin/login');
      } else {
        setLoadingSession(false);
      }
    };
    checkAuth();
  }, [router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setErrorMsg(null);
    setUploadStatus(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' });

        if (rawJson.length === 0) {
          throw new Error('File Excel kosong atau format tidak sesuai.');
        }

        const sampleRow = rawJson[0];
        const keys = Object.keys(sampleRow);

        const namaHeader = keys.find((k) => k.trim().toLowerCase() === 'nama lengkap');
        const nrpHeader = keys.find((k) => k.trim().toLowerCase() === 'nrp');

        if (!namaHeader || !nrpHeader) {
          throw new Error(
            `Header Excel tidak valid. Pastikan terdapat kolom "Nama Lengkap" dan "NRP". Header ditemukan: ${keys.join(', ')}`
          );
        }

        const parsedData = rawJson.map((row: any) => {
          let nrpStr = String(row[nrpHeader] || '').trim();

          if (nrpStr.length < 10 && /^\d+$/.test(nrpStr)) {
            nrpStr = nrpStr.padStart(10, '0');
          }

          return {
            nrp: nrpStr,
            nama_lengkap: String(row[namaHeader] || '').trim(),
          };
        }).filter((item) => item.nrp.length > 0 && item.nama_lengkap.length > 0);

        setPreviewRows(parsedData);
      } catch (err: any) {
        console.error('Parsing Excel error:', err);
        setErrorMsg(err.message || 'Gagal membaca file Excel.');
        setPreviewRows([]);
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleImportToDatabase = async () => {
    if (previewRows.length === 0) return;

    setIsProcessing(true);
    setErrorMsg(null);
    setUploadStatus('Mengunggah data ke tabel master_mahasiswa...');

    try {
      const chunkSize = 100;
      for (let i = 0; i < previewRows.length; i += chunkSize) {
        const chunk = previewRows.slice(i, i + chunkSize);
        const { error } = await supabase.from('master_mahasiswa').upsert(chunk, { onConflict: 'nrp' });

        if (error) {
          throw new Error(`Gagal mengimpor batch ${i / chunkSize + 1}: ${error.message}`);
        }
      }

      setUploadStatus(`Berhasil mengimpor ${previewRows.length} data master mahasiswa ke database!`);
    } catch (err: any) {
      console.error('Import DB error:', err);
      setErrorMsg(err.message || 'Terjadi kesalahan saat menyimpan data ke database.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000000] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-[#0071e3] dark:text-[#2997ff] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000000] text-[#1d1d1f] dark:text-[#f5f5f7] flex flex-col font-sans transition-colors duration-200">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 flex flex-col gap-8">
        <div className="apple-card rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col gap-6">
          <div className="flex items-center gap-3 border-b border-black/[0.06] dark:border-white/[0.08] pb-5">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Import Data Master Mahasiswa
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                Unggah file Excel berisi data master mahasiswa (Header: "Nama Lengkap" & "NRP").
              </p>
            </div>
          </div>

          {/* File Upload Box */}
          <div className="w-full p-10 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center text-center gap-3 bg-[#f5f5f7]/60 dark:bg-[#2c2c2e]/40">
            <FileSpreadsheet className="w-10 h-10 text-slate-400 dark:text-slate-500" />
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {file ? file.name : 'Pilih File Excel (.xlsx / .xls / .csv)'}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Kolom NRP akan secara otomatis diparse sebagai tipe teks string 10 digit.
              </p>
            </div>

            <label className="cursor-pointer bg-[#0071e3] hover:bg-[#0077ed] dark:bg-[#2997ff] dark:hover:bg-[#0071e3] text-white px-5 py-2 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95">
              <UploadCloud className="w-3.5 h-3.5" />
              Pilih File Excel
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {errorMsg && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {uploadStatus && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
              <span>{uploadStatus}</span>
            </div>
          )}

          {/* Preview Table */}
          {previewRows.length > 0 && (
            <div className="flex flex-col gap-4 mt-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Pratinjau Data Master ({previewRows.length} Baris Terbaca)
                </span>
                <button
                  onClick={handleImportToDatabase}
                  disabled={isProcessing}
                  className="px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs shadow-sm flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Mengimpor Data...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Impor ke Database
                    </>
                  )}
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto border border-black/[0.08] dark:border-white/[0.1] rounded-2xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#f5f5f7] dark:bg-[#2c2c2e] text-slate-700 dark:text-slate-300 font-semibold sticky top-0">
                    <tr>
                      <th className="p-3 px-4 border-b border-black/[0.06] dark:border-white/[0.08]">#</th>
                      <th className="p-3 px-4 border-b border-black/[0.06] dark:border-white/[0.08]">NRP (TEXT)</th>
                      <th className="p-3 px-4 border-b border-black/[0.06] dark:border-white/[0.08]">Nama Lengkap</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                    {previewRows.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/40">
                        <td className="p-3 px-4 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="p-3 px-4 font-mono font-medium text-[#0071e3] dark:text-[#2997ff]">
                          {row.nrp}
                        </td>
                        <td className="p-3 px-4 font-normal text-slate-800 dark:text-slate-200">{row.nama_lengkap}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewRows.length > 50 && (
                <p className="text-[11px] text-slate-400 text-center">
                  * Menampilkan 50 baris pertama dari total {previewRows.length} baris.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
