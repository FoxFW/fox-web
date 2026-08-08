# wallpapers/

Source folder for the [Wallpaper Showcase](https://foxfw.github.io/fox-web/wallpaper-showcase.html) page.

To publish a wallpaper, add two files here with the same name (the name is
what gets shown on the Showcase page):

- `NAME.png` or `NAME.bmp` - a preview image of the wallpaper (the 128x64
  artwork, however large/small you want the preview thumbnail to render).
- `NAME.zip` - a zip containing `wallpaper.xbm` (the actual file FoxFW reads
  from `/ext/wallpaper.xbm`). This is exactly what the Wallpaper Painter's
  "Download wallpaper.xbm" button produces, just zipped up.

Push both files to `main` and GitHub Actions (`.github/workflows/publish-wallpaper-index.yml`)
automatically regenerates `index.json`, which the Showcase page reads on
every load. No other step needed. If only one of the two files is present,
that wallpaper is silently skipped until its partner shows up - it won't
half-appear or error the page out.

`index.json` is generated, not hand-edited - don't commit changes to it
directly, they'll just get overwritten on the next push to this folder.
