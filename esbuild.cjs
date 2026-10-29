const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
};

async function build() {
  const host = {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  };
  const webview = {
    ...shared,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    minify: true,
    assetNames: 'assets/[name]-[hash]',
    loader: {
      '.css': 'css',
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    publicPath: './',
  };
  const mermaid = {
    ...shared,
    entryPoints: ['src/webview/mermaid-runtime.ts'],
    outfile: 'dist/mermaid.js',
    platform: 'browser',
    format: 'iife',
    minify: true,
    sourcemap: false,
  };

  if (!watch) {
    await Promise.all([esbuild.build(host), esbuild.build(webview), esbuild.build(mermaid)]);
    return;
  }

  const [hostContext, webviewContext, mermaidContext] = await Promise.all([
    esbuild.context(host),
    esbuild.context(webview),
    esbuild.context(mermaid),
  ]);
  await Promise.all([hostContext.watch(), webviewContext.watch(), mermaidContext.watch()]);
  console.log('Watching extension and webview sources.');
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
