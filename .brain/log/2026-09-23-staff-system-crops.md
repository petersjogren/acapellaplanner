# Staff-system crops

Prepare suggests staff-system crops from a PDF. Paper is estimated (photos are in scope, not assumed white). Every ink pixel is inside a crop; titles, lyrics, and footers absorb into the nearest system. A blank page returns no crop.

Empty film auto-shows suggestions after upload. Nothing is saved until Add all. Replace film is explicit and clears filmPins. Manual drag and single Add crop stay; a single add does not clear pins. Bulk appendSheetCrops and replaceSheetCrops do.

Detector is domain-pure in src/domain/staffSystems.ts. pdf/ does not import it. No schema bump.

Not done: deskew, OMR, auto-save. A crooked photo may come back as one ink box.

A barline that reaches both staves merges them, so one system is not sliced. Drag an edge of a suggested box to resize it before Add all.
