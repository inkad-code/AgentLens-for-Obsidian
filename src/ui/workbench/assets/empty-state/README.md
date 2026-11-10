# Empty-state artwork

The original Figma exports are retained as folder.png and add-creator.png.
The application imports the smaller runtime PNGs to stay within the 2 MiB main.js budget.

- folder-runtime.png: 282 × 234, twice the 141 × 117 display size.
- add-creator-runtime.png: 414 × 276, preserving the original image ratio and at least twice the 132 × 138 display resolution. The UI retains Figma's fill sizing.

Regenerate with ImageMagick from the originals:

    magick folder.png -resize 282x234 -strip -define png:compression-level=9 folder-runtime.png
    magick add-creator.png -resize 414x276 -strip -define png:compression-level=9 add-creator-runtime.png
