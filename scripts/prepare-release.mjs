import fs from 'node:fs/promises';

const version = process.argv[2] || process.env.npm_package_version;

if (!/^\d+\.\d+\.\d+(?:[-\w.]+)?$/.test(version || '')) {
  console.error('Usage: node scripts/prepare-release.mjs <version>');
  process.exit(1);
}

const packagePath = new URL('../package.json', import.meta.url);
const packageLockPath = new URL('../package-lock.json', import.meta.url);

const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
pkg.version = version;
pkg.build = {
  ...pkg.build,
  directories: {
    ...(pkg.build?.directories || {}),
    output: `release-${version}`,
  },
};
await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

try {
  const lock = JSON.parse(await fs.readFile(packageLockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) {
    lock.packages[''].version = version;
  }
  await fs.writeFile(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log(`Prepared release ${version} -> release-${version}`);
