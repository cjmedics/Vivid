# Figma frame to product video

This milestone supplies the deterministic design-to-video path: structured frame
annotations, an explicit brand kit, supplied copy, a validated ShotPlan, an upfront
usage estimate, and Remotion output. It adds no paid model calls.

## Run the checked-in sample

Use Node 22 or newer and install dependencies with `npm ci`.

```bash
npm run create:sample -- --render
```

Outputs are saved in `out/design-sample/`: `product-ir.json`, `render-props.json`,
`estimate.json`, `production.json`, and `video.mp4`. The command refuses an existing
output directory; use a new `--out` path on subsequent runs. `--render` is optional:
without it, the command only saves the plan and quote. Build Minutes are an estimate;
local runs do not charge an account. On failure, the production remains marked failed.

The sample JSON is a purpose-built Figma nodes-response fixture and its matching PNG.
It is not a public Figma file or evidence of a live account integration. CI renders
the sample and checks codec, dimensions, frame rate, frame count, duration, and full
decoding. Its artifact also includes a contact sheet for visual review.

## Import an authorized Figma frame

Set `FIGMA_ACCESS_TOKEN` in the shell or an untracked `.env` file. Use a personal
access token with `file_content:read` and access to the design. Select a frame,
component, or instance in Figma and copy its link (including `node-id`).

```bash
npm run create -- \
  --figma 'https://www.figma.com/design/FILE_KEY/Design?node-id=1-2' \
  --brand fixtures/design.brand.json \
  --brief fixtures/design.brief.json \
  --out out/my-first-design \
  --render
```

Replace the sample brand and brief files with your own JSON. A brand kit contains
six-digit `primary`, `background`, `foreground`, and `accent` hex colors plus
`fontFamily`. A brief contains `productName`, `description`, `category`, `headline`,
`subtext`, and `cta`. Copy length limits fail explicitly rather than silently rewriting
text. Use `--logo path/to/logo.png` and `--font path/to/font.woff2` to embed brand
assets. Without an embedded font, overlay typography uses available system fonts;
the exported Figma frame itself preserves the design's rendered typography.

The importer reads `/v1/files/:key/nodes`, then exports the same version through
`/v1/images/:key` with `use_absolute_bounds=true`. It normalizes bounding boxes,
records file/version/node provenance, retains text font and solid-fill metadata where
available, skips hidden and off-frame layers, and clips regions to the selected frame.
It downloads the PNG without forwarding API credentials and embeds its bytes.
Authentication and rate-limit errors are surfaced without blind retries.

API documentation: [file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
and [authentication](https://developers.figma.com/docs/rest-api/authentication/).

## Use an existing export without API access

Supply a JSON response from Figma's file-nodes endpoint and the matching exported
PNG. The selected frame ID must match the response. `use_absolute_bounds=true` is
important so highlights use the same coordinate system as the image.

```bash
npm run create -- \
  --figma 'https://www.figma.com/design/FILE_KEY/Design?node-id=1-2' \
  --figma-json path/to/nodes-response.json --capture path/to/frame.png \
  --brand path/to/brand.json --brief path/to/brief.json \
  --out out/offline-design --render
```

The aspect ratio is checked; matching dimensions do not establish that a separately
supplied image is from the same design. Offline exports must be paired by the operator.

## Screenshot fallback

Use `--screenshot frame.png --regions regions.json` instead of the Figma flags.
`regions.json` is a nonempty array of region annotations: `id`, `kind`, `label`,
`bbox` (`x`, `y`, `w`, `h` normalized to the full image), and `focalScore` (0–1).
The fallback currently needs these explicit annotations; visual model inference
is a later integration. PNG captures are limited to 20 MiB.

## Planning contracts and limits

- `ProductIR`: frame, evidence provenance, normalized regions, brand tokens, and copy.
- `PacingProfile`: explicit intro, overview, focus, outro, and transition durations.
  Use `--pacing profile.json` to override defaults. Reference-video extraction is not built.
- `ShotPlan`: the same spec consumed by estimation and rendering. Semantic validation
  rejects duplicate IDs, unknown screens/regions/primitives, incompatible targets,
  out-of-shot timing, and simulated data changes on static captures.
- Design Reveal shows the frame, focuses on up to three distinct areas, and closes
  with a CTA. Layer names and geometry drive heuristic classification/ranking; there
  is no visual model inference in ingestion. Optional [AI planning](ai-planning.md) can
  select the viewing order from structured annotations. Missing metrics do not block a reveal.
- Screenshot mode presents a static frame. Optional SVG layer reconstruction animates
  independent source elements; neither mode invents interaction outcomes, modifies
  product values, or reproduces working product behavior.
- The MVP create command exports only 16:9, at the account's production resolution
  (720p on Starter, 1080p on Pro). It adds no audio, UI, subscriptions, or durable jobs.
- Production asset storage, billing finalization, and live-model routing remain separate
  milestones. Do not treat the existing executor's pre-render charge as final delivery.

Live API behavior is contract-tested with mocked responses. Real account access,
export permissions, and limits must be checked with an authorized customer frame.

## Layer reconstruction and entrances

Add `--layers` to a live import. Vivid requests an additional SVG export of the same
file version with `svg_outline_text=true`, `svg_include_node_id=true`, and
`use_absolute_bounds=true`. Outlining preserves source glyphs without requiring the
design fonts on the render worker. Text is vector artwork, not editable typography.

The engine parses SVG into an allowlisted scene tree. It retains paint order, nested
transforms, shapes, gradients, embedded raster images, masks, and clipping references.
Scripts, foreign objects, external resources, and unsupported SVG features fail
explicitly. It does not silently replace a failed layer import with a screenshot.

Source node IDs match exported elements to Figma metadata. Up to 120 visible text,
image, and component nodes receive staggered entrances. Components animate as units;
their children remain intact and do not receive a second entrance. Other artwork and
definitions stay static. Text and components rise into position; images reveal through
a mask. Timing depends only on the current frame and finishes within the overview
beat. Later focus shots show the fully reconstructed design without repeating entrances.

`product-ir.json` and `render-props.json` embed the vector scene and its images;
`layer-report.json` lists independently animated source IDs and kinds. Live imports
also preserve `source.nodes.json`, `source.capture.png`, and `source.layers.svg`
alongside the production so further work can run offline without consuming API quota.

Offline example:

```bash
npm run create -- --figma 'https://www.figma.com/design/FILE_KEY/Design?node-id=1-2' \
  --figma-json path/to/source.nodes.json --capture path/to/source.capture.png \
  --layers --figma-svg path/to/source.layers.svg \
  --brand path/to/brand.json --brief path/to/brief.json --out out/layered --render
```

`npm run create:layered-sample -- --render` exercises a purpose-built SVG fixture.
It is not a pixel-matched version of the older PNG fixture. The live workflow also
renders `reconstructed-frame.png` using the `VividLayerReference` composition for
comparison with the original export. At the owner's request, the MP4 is saved
without video encryption as `vivid-layer-motion.mp4` in an unpublished draft release.
Download that MP4 directly; no certificate, private key, or decryption secret is
needed to watch a new render. The workflow never publishes the release, keeping the
video restricted to repository writers rather than exposing it in public-repository
workflow artifacts.

The separate full-source backup remains encrypted because it includes Figma nodes,
SVGs and production metadata beyond the approved MP4 preview. Its encryption does
not block the direct MP4 delivery step, which runs first. The validation script does
not delete source files or overwrite previous productions. Legacy encrypted archives
are preserved unchanged and still require their original key. Backup workflow
artifacts expire after 90 days; draft-release MP4s remain until explicitly removed.

This first layer milestone is deterministic scene reconstruction, not text reflow,
word/character animation inside outlined text, interaction inference, or AI art direction.
Source geometry and supported SVG effects remain authoritative; choreography is
heuristic. More complex unsupported SVG exports require importer extensions.
