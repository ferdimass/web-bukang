-- ==============================================================================
-- SQL SETUP SETUP SUPABASE UNTUK BUKU ANGKATAN 2026
-- Jalankan seluruh script ini di SQL Editor dashboard Supabase Anda.
-- ==============================================================================

-- 1. Buat Tabel Master Mahasiswa (Data Referensi Excel)
CREATE TABLE IF NOT EXISTS public.master_mahasiswa (
    nrp VARCHAR(10) PRIMARY KEY,
    nama_lengkap TEXT NOT NULL
);

-- 2. Buat Tabel Entri Data Mahasiswa
CREATE TABLE IF NOT EXISTS public.buku_angkatan_entries (
    nrp VARCHAR(10) PRIMARY KEY REFERENCES public.master_mahasiswa(nrp) ON DELETE CASCADE,
    nama_lengkap TEXT NOT NULL,
    prodi TEXT,
    asal_daerah TEXT,
    hobi TEXT,
    first_impression TEXT,
    foto_url TEXT,
    geotag_lat DOUBLE PRECISION,
    geotag_lng DOUBLE PRECISION,
    geotag_address TEXT,
    geotag_timestamp TIMESTAMPTZ,
    status_lengkap TEXT DEFAULT 'Belum Lengkap',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Function & Trigger untuk Penentuan Otomatis status_lengkap & updated_at
CREATE OR REPLACE FUNCTION public.check_entry_status()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    IF NEW.prodi IS NOT NULL AND NEW.prodi != '' AND
       NEW.asal_daerah IS NOT NULL AND NEW.asal_daerah != '' AND
       NEW.hobi IS NOT NULL AND NEW.hobi != '' AND
       NEW.first_impression IS NOT NULL AND NEW.first_impression != '' AND
       NEW.foto_url IS NOT NULL AND NEW.foto_url != '' AND
       NEW.geotag_lat IS NOT NULL AND
       NEW.geotag_lng IS NOT NULL AND
       NEW.geotag_address IS NOT NULL AND NEW.geotag_address != '' AND
       NEW.geotag_timestamp IS NOT NULL THEN
        NEW.status_lengkap := 'Lengkap';
    ELSE
        NEW.status_lengkap := 'Belum Lengkap';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_entry_status ON public.buku_angkatan_entries;
CREATE TRIGGER trg_check_entry_status
BEFORE INSERT OR UPDATE ON public.buku_angkatan_entries
FOR EACH ROW EXECUTE FUNCTION public.check_entry_status();

-- 4. Konfigurasi Row Level Security (RLS) & Kebijakan Akses (Public Read/Write)
ALTER TABLE public.master_mahasiswa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buku_angkatan_entries ENABLE ROW LEVEL SECURITY;

-- Policy untuk master_mahasiswa
DROP POLICY IF EXISTS "Public select master" ON public.master_mahasiswa;
CREATE POLICY "Public select master" ON public.master_mahasiswa FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin insert/update master" ON public.master_mahasiswa;
CREATE POLICY "Admin insert/update master" ON public.master_mahasiswa FOR ALL USING (true);

-- Policy untuk buku_angkatan_entries
DROP POLICY IF EXISTS "Public select entries" ON public.buku_angkatan_entries;
CREATE POLICY "Public select entries" ON public.buku_angkatan_entries FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert/update entries" ON public.buku_angkatan_entries;
CREATE POLICY "Public insert/update entries" ON public.buku_angkatan_entries FOR ALL USING (true);

-- 5. Setup Storage Bucket: foto-angkatan
INSERT INTO storage.buckets (id, name, public)
VALUES ('foto-angkatan', 'foto-angkatan', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Public Storage Read" ON storage.objects;
CREATE POLICY "Public Storage Read" ON storage.objects FOR SELECT USING (bucket_id = 'foto-angkatan');

DROP POLICY IF EXISTS "Public Storage Insert" ON storage.objects;
CREATE POLICY "Public Storage Insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'foto-angkatan');

DROP POLICY IF EXISTS "Public Storage Update" ON storage.objects;
CREATE POLICY "Public Storage Update" ON storage.objects FOR UPDATE USING (bucket_id = 'foto-angkatan');
