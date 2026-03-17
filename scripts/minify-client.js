const fs = require('fs/promises');
const path = require('path');
const terser = require('terser');

async function minifyInlineScript() {
    const projectRoot = path.resolve(__dirname, '..');
    const inputPath = path.join(projectRoot, 'public', 'index.html');
    const outputPath = path.join(projectRoot, 'public', 'index.min.html');

    const html = await fs.readFile(inputPath, 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);

    if (!scriptMatch) {
        throw new Error('No inline <script> block found in public/index.html');
    }

    const originalJs = scriptMatch[1];
    const minified = await terser.minify(originalJs, {
        compress: true,
        mangle: true,
        format: { comments: false }
    });

    if (minified.error) {
        throw minified.error;
    }

    const minifiedHtml = html.replace(scriptMatch[0], `<script>${minified.code}</script>`);
    await fs.writeFile(outputPath, minifiedHtml, 'utf8');

    console.log(`Minified build written to ${outputPath}`);
}

minifyInlineScript().catch((err) => {
    console.error('Minify build failed:', err.message);
    process.exit(1);
});
