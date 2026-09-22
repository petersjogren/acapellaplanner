# Canvas drawFilmFrame painter

`src/export/drawFilmFrame.ts` paints one film frame onto a canvas ctx. Pixel math stays in `domain/sheets.ts`. Single crop is centred for YouTube; multi-crop clips to the viewport so partial slides do not smear. Tests in `tests/export/drawFilmFrame.test.ts`. Encode/mix/Review not started.
