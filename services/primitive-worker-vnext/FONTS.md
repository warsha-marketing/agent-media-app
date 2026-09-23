# Fonts in the worker image

Fonts the worker burns into Shorts, where they come from, and their licences.
They are installed from Debian packages in `Dockerfile`; none is vendored here.

| Used for | Font | Debian package | Licence |
|---|---|---|---|
| Arabic Captions (`src/lib/arabic-captions-ass.ts`) | Noto Sans Arabic Bold | `fonts-noto-core` (bookworm) | SIL Open Font License 1.1 |
| English captions (`src/lib/ass.ts`) | Liberation Sans Bold | `fonts-liberation` | SIL Open Font License 1.1 |

The OFL allows embedding and rendering the fonts into commercial video (burned
captions are rendered output, not a redistribution of the font). The full
licence text ships in the image at `/usr/share/doc/<package>/copyright`.

Arabic Captions name the font `Noto Sans Arabic` (bold) in their ASS style; if
the package is missing, libass would fall back to another font, so the
real-ffmpeg test (`src/__tests__/arabic-captions.ffmpeg.test.ts`) asserts the
burn used `NotoSansArabic` and is skipped only where the font is absent.
