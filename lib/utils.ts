/**
 * Automatic classification of Prodi based on NRP pattern:
 * - Starts with 502525 -> Teknik Informatika
 * - Starts with 5054   -> Rekayasa Kecerdasan Artifisial
 * - Starts with 5053   -> Rekayasa Perangkat Lunak
 */
export function getProdiByNRP(nrp: string): string {
  const cleanNrp = (nrp || '').trim();
  if (cleanNrp.startsWith('502525')) {
    return 'Teknik Informatika';
  }
  if (cleanNrp.startsWith('5054')) {
    return 'Rekayasa Kecerdasan Artifisial';
  }
  if (cleanNrp.startsWith('5053')) {
    return 'Rekayasa Perangkat Lunak';
  }
  return 'Teknik Informatika'; // Default option
}

/**
 * Sanitize filename to prevent invalid characters in ZIP export:
 * {NRP}_{NamaLengkap}.jpg with spaces replaced by underscores.
 */
export function sanitizeFilename(name: string): string {
  if (!name) return 'mahasiswa';
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/\s+/g, '_');
}

/**
 * Client-side browser image compression:
 * Resizes max width/height to ~1000px and compresses JPEG quality to ~75%.
 */
export async function compressImage(file: File, maxWidth = 1000, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas compression failed'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}
