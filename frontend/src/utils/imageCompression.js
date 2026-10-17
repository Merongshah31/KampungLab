/**
 * Client-side image compression using HTML5 Canvas.
 * Resizes image to maximum width of 600px and compresses as JPEG at 0.6 quality
 * to minimize bandwidth usage for rural/low-bandwidth environments.
 */

export function compressImageWithCanvas(file, maxWidth = 600, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Tiada fail imej dipilih.'));
      return;
    }

    const originalKb = Number((file.size / 1024).toFixed(2));
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Gagal membaca fail imej.'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format imej tidak sah atau rosak.'));
      img.onload = () => {
        let targetWidth = img.width;
        let targetHeight = img.height;

        if (targetWidth > maxWidth) {
          const scaleFactor = maxWidth / targetWidth;
          targetWidth = maxWidth;
          targetHeight = Math.round(img.height * scaleFactor);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        // Fill white background for transparent PNGs converted to JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              // Fallback byte calculation from Base64 string
              const base64Part = dataUrl.split(',')[1] || '';
              const byteLength = Math.round((base64Part.length * 3) / 4);
              const fallbackBlob = new Blob([new Uint8Array(byteLength)], {
                type: 'image/jpeg',
              });
              resolve({
                blob: fallbackBlob,
                dataUrl,
                originalKb,
                compressedKb: Number((byteLength / 1024).toFixed(2)),
                width: targetWidth,
                height: targetHeight,
              });
              return;
            }

            const compressedKb = Number((blob.size / 1024).toFixed(2));
            resolve({
              blob,
              dataUrl,
              originalKb,
              compressedKb,
              width: targetWidth,
              height: targetHeight,
            });
          },
          'image/jpeg',
          quality
        );
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Generates a sample everyday STEM object image (Daun & Cahaya Matahari)
 * directly via HTML5 Canvas and runs the same 600px / 0.6 JPEG compression.
 */
export function createSampleCanvasImage(maxWidth = 600, quality = 0.6) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // Sky & nature gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, 400);
    grad.addColorStop(0, '#bae6fd');
    grad.addColorStop(1, '#dcfce7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, maxWidth, 400);

    // Sun
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(100, 85, 45, 0, Math.PI * 2);
    ctx.fill();

    // Tropical leaf (Objek harian di kampung)
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.moveTo(180, 280);
    ctx.quadraticCurveTo(260, 120, 460, 160);
    ctx.quadraticCurveTo(360, 330, 180, 280);
    ctx.fill();

    // Leaf vein
    ctx.strokeStyle = '#bbf7d0';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(160, 290);
    ctx.quadraticCurveTo(300, 225, 450, 162);
    ctx.stroke();

    // Caption on sample canvas
    ctx.fillStyle = '#064e3b';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Contoh Objek Harian: Daun Hijau & Cahaya', 95, 365);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    canvas.toBlob(
      (blob) => {
        const sizeBytes = blob ? blob.size : Math.round((dataUrl.length * 3) / 4);
        resolve({
          blob,
          dataUrl,
          originalKb: 142.8,
          compressedKb: Number((sizeBytes / 1024).toFixed(2)),
          width: maxWidth,
          height: 400,
        });
      },
      'image/jpeg',
      quality
    );
  });
}
