const fs = require('fs');
const path = require('path');

const botsDir = path.join(__dirname, '../public/bots');
const manifestPath = path.join(botsDir, 'manifest.json');

console.log('🔍 Scanning bots directory:', botsDir);

try {
    if (!fs.existsSync(botsDir)) {
        console.error('❌ Bots directory does not exist!');
        process.exit(1);
    }

    const files = fs.readdirSync(botsDir);
    const xmlFiles = files.filter(file => file.endsWith('.xml'));

    let currentManifest = [];
    if (fs.existsSync(manifestPath)) {
        try {
            currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
            console.warn('⚠️ Could not parse existing manifest.json, starting fresh.');
        }
    }

    const updatedManifest = xmlFiles.map(file => {
        const existing = currentManifest.find(item => item.name === file);
        
        // Random success rate between 78 and 96 for demo purposes if not existing
        const defaultRate = Math.floor(Math.random() * (96 - 78 + 1)) + 78;

        return {
            id: existing?.id || file.replace('.xml', '').toLowerCase().replace(/_/g, '-'),
            name: file,
            description: existing?.description || `High-performance strategic bot: ${file.replace('.xml', '').replace(/_/g, ' ')}. Optimized for the 2026 market.`,
            category: existing?.category || 'Trading Strategy',
            icon: existing?.icon || (file.toLowerCase().includes('ai') ? 'ai' : 'chart'),
            status: existing?.status || (Math.random() > 0.5 ? 'Trending' : 'Stable'),
            accuracy: existing?.accuracy || defaultRate,
            isPremium: existing?.isPremium !== undefined ? existing.isPremium : true
        };
    });

    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 4));
    console.log(`✅ Successfully indexed ${updatedManifest.length} bots in manifest.json`);

} catch (error) {
    console.error('❌ Error generating bot manifest:', error);
    process.exit(1);
}
