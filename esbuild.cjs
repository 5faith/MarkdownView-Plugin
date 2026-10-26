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
    assetNames: 'assets/[name]-[hash]',
    loader: {
      '.css': 'css',
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    publicPath: './',
  };

  if (!watch) {
    await Promise.all([esbuild.build(host), esbuild.build(webview)]);
    return;
  }

  const [hostContext, webviewContext] = await Promise.all([
    esbuild.context(host),
    esbuild.context(webview),
  ]);
  await Promise.all([hostContext.watch(), webviewContext.watch()]);
  console.log('Watching extension and webview sources.');
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
