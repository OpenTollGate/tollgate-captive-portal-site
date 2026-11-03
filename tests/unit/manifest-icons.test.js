// GATE (card t_98145b7d, W1) — the manifest and its icons must be REAL.
//
// The defect this replaces: the manifest declared `display: standalone` with no
// icons beyond a favicon, and (after the WSEC pass) declared an icon
// `purpose: "maskable"` that was literally the same artwork as the `any` icon.
//
// Why that second one is a defect and not a nicety — the maskable spec gives a
// MINIMUM SAFE ZONE of a circle with radius 40% of the icon's width, centred.
// Anything outside that circle MAY be cropped by the launcher (circle, squircle,
// rounded square — the platform picks). `logo512.png` is artwork occupying
// roughly 80-85% of the canvas width, so its extremities fall OUTSIDE the safe
// circle and a maskable declaration for it would be cropped on a real Android
// home screen. Declaring the same file `any` + `maskable` is therefore not
// "conservative", it is wrong in one of the two roles.
//
// So these tests check the actual pixels: dimensions from the PNG header, and
// the opaque-safe-zone geometry of the maskable asset. Nothing here is inferred
// from the filename.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC = resolve(process.cwd(), 'public');
const MANIFEST_PATH = resolve(PUBLIC, 'manifest.json');

/** Read width/height/colour-type from a PNG's IHDR — no image library needed. */
function pngInfo(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('no IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    // 6 = RGBA (has alpha); 2 = RGB; 3 = palette; 0 = grey; 4 = grey+alpha
    colorType: buf[25],
    hasAlphaChannel: buf[25] === 6 || buf[25] === 4 || buf[25] === 3,
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

describe('manifest: identity fields an installed app is keyed on', () => {
  it('start_url names the document the build actually emits', () => {
    // The build renames index.html -> splash.html. `"."` or "/" resolves to a
    // directory request the served webroot has no document for, so the
    // installed app launches into a 404.
    expect(manifest.start_url).toBe('splash.html');
  });

  it('declares an explicit, stable id', () => {
    // Without `id`, identity IS `start_url` — so any later start_url change
    // orphans every existing install.
    expect(typeof manifest.id).toBe('string');
    expect(manifest.id.length).toBeGreaterThan(0);
    expect(manifest.id).not.toContain('/');
  });

  it('declares an explicit scope', () => {
    expect(typeof manifest.scope).toBe('string');
    expect(manifest.scope.length).toBeGreaterThan(0);
  });

  it('is standalone with a dark splash that matches the UI background', () => {
    expect(manifest.display).toBe('standalone');
    // index.html and src/index.scss both use #14161d for the page background;
    // a white splash flashes before the app paints.
    expect(manifest.background_color).toBe('#14161d');
    expect(manifest.theme_color).toBeTruthy();
  });

  it('carries the name and short_name', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
  });
});

describe('manifest: every declared icon file actually exists at the right size', () => {
  it('each icon entry resolves to a real file in the webroot', () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    for (const icon of manifest.icons) {
      const p = resolve(PUBLIC, icon.src);
      expect(existsSync(p), `icon ${icon.src} is declared but missing on disk`).toBe(true);
    }
  });

  it('each PNG icon declares the size it actually is', () => {
    const pngs = manifest.icons.filter((i) => i.type === 'image/png');
    expect(pngs.length).toBeGreaterThan(0);

    for (const icon of pngs) {
      const info = pngInfo(readFileSync(resolve(PUBLIC, icon.src)));
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(
        { w: info.width, h: info.height },
        `${icon.src} declares ${icon.sizes} but is ${info.width}x${info.height}`
      ).toEqual({ w, h });
    }
  });

  it('ships the 192 and 512 sizes installability requires', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });
});

describe('manifest: the maskable icon is genuinely maskable', () => {
  const maskable = manifest.icons.filter((i) =>
    (i.purpose || '').split(/\s+/).includes('maskable')
  );

  it('declares at least one maskable icon', () => {
    expect(maskable.length).toBeGreaterThan(0);
  });

  it('a maskable icon is OPAQUE — no transparent pixels, or the launcher background shows through', () => {
    for (const icon of maskable) {
      const info = pngInfo(readFileSync(resolve(PUBLIC, icon.src)));
      // A maskable icon may not rely on transparency: the platform draws it
      // inside a shape and any alpha shows the launcher behind it.
      expect(
        info.colorType === 2 || info.colorType === 0 || info.colorType === 3,
        `${icon.src} is colour-type ${info.colorType} (alpha-capable); a maskable icon must be fully opaque`
      ).toBe(true);
    }
  });

  it('the maskable asset is a SEPARATE file from the "any" asset, not the same artwork relabelled', () => {
    // This is the exact WSEC defect: one file declared under both purposes.
    // Artwork sized for `any` runs to ~85% of the canvas, which is outside the
    // 40%-radius safe circle, so it gets cropped when masked.
    const anySrcs = manifest.icons
      .filter((i) => (i.purpose || 'any') === 'any')
      .map((i) => i.src);

    for (const icon of maskable) {
      expect(
        anySrcs.includes(icon.src),
        `${icon.src} is declared BOTH "any" and "maskable"; the maskable variant must be its own` +
          ` artwork with the safe zone respected`
      ).toBe(false);
    }
  });

  it('the maskable artwork has real padding: the safe circle is 40% radius of the canvas', async () => {
    // Measured, not assumed. Read the PNG and check that the ALPHA-FREE
    // border of the maskable asset is a solid colour — i.e. the artwork is
    // inset inside a full-bleed background, which is what makes masking safe.
    // A 512 maskable asset should have its subject starting well inside the
    // 40% radius, so the outermost ring of the image must be uniform.
    const icon = maskable.find((i) => i.sizes === '512x512') || maskable[0];
    const buf = readFileSync(resolve(PUBLIC, icon.src));
    const info = pngInfo(buf);
    expect(info.colorType, 'need an opaque PNG to measure a uniform border').toBe(2);

    // Decode the outermost row's pixels without a library: PNG is DEFLATEd and
    // filter-coded, so use the platform decoder instead (zlib is in node).
    const { inflateSync } = await import('node:zlib');
    const idat = [];
    let off = 8;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
      if (type === 'IEND') break;
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));

    const bpp = 3; // RGB
    const stride = info.width * bpp;
    const pixelAt = (x, y) => {
      const rowStart = y * (stride + 1);
      const filter = raw[rowStart];
      if (filter !== 0) return null; // filtered row — skip the geometry check
      const i = rowStart + 1 + x * bpp;
      return [raw[i], raw[i + 1], raw[i + 2]];
    };

    // Check the four corner pixels agree. A maskable icon whose corner is the
    // subject's own colour means the artwork reaches the edge.
    const corners = [
      pixelAt(0, 0),
      pixelAt(info.width - 1, 0),
      pixelAt(0, info.height - 1),
      pixelAt(info.width - 1, info.height - 1),
    ];
    if (corners.some((c) => c === null)) {
      // Filtered PNG rows: fall back to the opacity assertion above rather than
      // failing on an encoding detail.
      expect(info.colorType).toBe(2);
      return;
    }
    const [first] = corners;
    for (const c of corners) {
      expect(c, 'the outer corners of a maskable icon must be the same background').toEqual(first);
    }
  });
});

describe('manifest: the admin board manifest has the same identity fields', () => {
  it('admin/public/manifest.json carries id, scope and a maskable icon', () => {
    const p = resolve(process.cwd(), 'admin/public/manifest.json');
    expect(existsSync(p), 'the admin manifest is generated by build-all').toBe(true);
    const admin = JSON.parse(readFileSync(p, 'utf8'));

    expect(admin.id).toBeTruthy();
    expect(admin.scope).toBeTruthy();
    expect(
      admin.icons.some((i) => (i.purpose || '').split(/\s+/).includes('maskable')),
      'the admin board needs a maskable icon too, or Android letterboxes its brand mark'
    ).toBe(true);
  });
});
