// Empties dist/ before a build. Vite's emptyOutDir (fs.rmSync) silently
// leaves everything in place under Node 24 on Windows when the path has
// non-ASCII characters, so old bundles piled up and got embedded in the exe.
// Deleting entry by entry works.
import {existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

function remove(p) {
    if (!existsSync(p)) return;
    if (lstatSync(p).isDirectory()) {
        for (const name of readdirSync(p)) remove(join(p, name));
        rmdirSync(p);
    } else {
        unlinkSync(p);
    }
}

const dist = fileURLToPath(new URL('../dist', import.meta.url));
remove(dist);
if (existsSync(dist)) {
    console.error(`clean-dist: could not remove ${dist}`);
    process.exit(1);
}
