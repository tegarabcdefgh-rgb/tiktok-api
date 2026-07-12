const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// ---------- KONFIGURASI yt-dlp ----------
const ytdlp = 'yt-dlp';
console.log('Menggunakan yt-dlp dari PATH');

// ---------- DUKUNGAN COOKIES UNTUK INSTAGRAM ----------
const COOKIES_PATH = '/app/cookies.txt';
const useCookies = fs.existsSync(COOKIES_PATH);
const cookieOption = useCookies ? `--cookies ${COOKIES_PATH}` : '';
console.log(`Instagram cookies: ${useCookies ? '✅ tersedia' : '❌ tidak ada (beberapa konten mungkin gagal)'}`);

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────
// TIKTOK (tetap sama, tanpa cookies)
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/download-tiktok', async (req, res) => {
    let videoUrl = req.query.url;
    videoUrl = videoUrl ? String(videoUrl).trim().split(/\s+/)[0] : videoUrl;
    if (!videoUrl) {
        return res.status(400).json({ error: 'Parameter URL diperlukan' });
    }
    if (!videoUrl.includes('tiktok.com')) {
        return res.status(400).json({ error: 'URL tidak valid. Harus dari tiktok.com' });
    }
    try {
        const { stdout } = await execPromise(`${ytdlp} -j --no-warnings "${videoUrl}"`);
        const data = JSON.parse(stdout);
        res.json({
            status: 'success',
            video_url: data.url,
            title: data.title,
            uploader: data.uploader,
            view_count: data.view_count,
            like_count: data.like_count,
            comment_count: data.comment_count,
            repost_count: data.repost_count,
            description: data.description,
        });
    } catch (error) {
        console.error('Error metadata TikTok:', error.message);
        res.status(500).json({ error: 'Gagal memproses video TikTok', details: error.message });
    }
});

app.get('/api/download-video', (req, res) => {
    let videoUrl = req.query.url;
    videoUrl = videoUrl ? String(videoUrl).trim().split(/\s+/)[0] : videoUrl;
    if (!videoUrl) return res.status(400).json({ error: 'URL required' });
    if (!videoUrl.includes('tiktok.com')) return res.status(400).json({ error: 'Invalid TikTok URL' });

    const args = ['-f', 'best', '-o', '-', videoUrl];
    const ytdlpProc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const filename = `tiktok_${uuidv4()}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    ytdlpProc.stdout.pipe(res);

    let stderr = '';
    ytdlpProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ytdlpProc.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process', details: err.message });
    });

    ytdlpProc.on('close', (code) => {
        if (code !== 0) {
            console.error('yt-dlp exited with code', code, stderr);
            if (!res.finished) res.status(500).end();
        }
    });

    req.on('close', () => {
        if (!res.writableEnded) ytdlpProc.kill('SIGKILL');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// INSTAGRAM (dengan cookies)
// ─────────────────────────────────────────────────────────────────────────

function isInstagramUrl(url) {
    return /instagram\.com\/(p|reel|reels|tv)\//i.test(url) || /instagram\.com/i.test(url);
}

app.get('/api/download-instagram', async (req, res) => {
    let mediaUrl = req.query.url;
    mediaUrl = mediaUrl ? String(mediaUrl).trim().split(/\s+/)[0] : mediaUrl;
    if (!mediaUrl) {
        return res.status(400).json({ error: 'Parameter URL diperlukan' });
    }
    if (!isInstagramUrl(mediaUrl)) {
        return res.status(400).json({ error: 'URL tidak valid. Harus dari instagram.com' });
    }
    try {
        // 🔥 GABUNGKAN opsi cookies ke perintah
        const command = `${ytdlp} ${cookieOption} -j --no-warnings "${mediaUrl}"`;
        console.log(`[IG Metadata] Executing: ${command}`); // opsional, untuk debugging
        const { stdout } = await execPromise(command);
        const data = JSON.parse(stdout);

        const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes((data.ext || '').toLowerCase());

        res.json({
            status: 'success',
            media_type: isImage ? 'image' : 'video',
            media_url: data.url,
            title: data.title || data.description,
            uploader: data.uploader || data.channel,
            like_count: data.like_count,
            comment_count: data.comment_count,
            description: data.description,
            thumbnail: data.thumbnail,
        });
    } catch (error) {
        console.error('Error metadata IG:', error.message);
        // Beri pesan yang lebih jelas jika cookies bermasalah
        let detail = error.message;
        if (error.message.includes('HTTP Error 404') || error.message.includes('Not Found')) {
            detail = 'Postingan tidak ditemukan. Mungkin URL salah atau konten bersifat privat.';
        } else if (error.message.includes('Login Required') || error.message.includes('cookie')) {
            detail = 'Instagram memerlukan login. Pastikan file cookies.txt valid dan belum kadaluarsa.';
        }
        res.status(500).json({ error: 'Gagal memproses postingan Instagram', details: detail });
    }
});

app.get('/api/download-instagram-media', (req, res) => {
    let mediaUrl = req.query.url;
    mediaUrl = mediaUrl ? String(mediaUrl).trim().split(/\s+/)[0] : mediaUrl;
    if (!mediaUrl) return res.status(400).json({ error: 'URL required' });
    if (!isInstagramUrl(mediaUrl)) return res.status(400).json({ error: 'Invalid Instagram URL' });

    // 🔥 TAMBAHKAN cookies ke argumen spawn
    const args = ['-f', 'best', '-o', '-', mediaUrl];
    if (useCookies) {
        args.unshift('--cookies', COOKIES_PATH);
    }
    const ytdlpProc = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const filename = `instagram_${uuidv4()}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    ytdlpProc.stdout.pipe(res);

    let stderr = '';
    ytdlpProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ytdlpProc.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start download process', details: err.message });
    });

    ytdlpProc.on('close', (code) => {
        if (code !== 0) {
            console.error('yt-dlp exited with code', code, stderr);
            if (!res.finished) res.status(500).end();
        }
    });

    req.on('close', () => {
        if (!res.writableEnded) ytdlpProc.kill('SIGKILL');
    });
});

app.listen(PORT, () => {
    console.log(`✅ Media API berjalan di http://localhost:${PORT}`);
    console.log(`📱 TikTok metadata: http://localhost:${PORT}/api/download-tiktok?url=...`);
    console.log(`📱 Instagram metadata: http://localhost:${PORT}/api/download-instagram?url=...`);
});