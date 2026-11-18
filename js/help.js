// Plain-language help for every option (from the desktop app). key -> {title, text, rec}
export const HELP = {
 "tiles_folder": {
  "title": "Your photos",
  "text": "The photos that will become the small tiles. Pick them from your gallery or choose a whole folder. Nothing is uploaded: everything stays on your device. More photos means a more varied mosaic; around 300 or more looks best.",
  "rec": "A few hundred photos for a rich result."
 },
 "subfolders": {
  "title": "Include photos in sub-folders",
  "text": "When on, photos inside folders within the folder you chose are used too. You can also leave out particular folders (for example screenshots).",
  "rec": "On"
 },
 "main_image": {
  "title": "Main picture",
  "text": "The big picture your mosaic will recreate from the tiles. Pick one with a clear subject, such as a face or a simple scene. Busy backgrounds turn into noise.",
  "rec": "A sharp portrait with a plain background."
 },
 "existing": {
  "title": "Use a mosaic I already built",
  "text": "Not available in the web version yet: build the mosaic again, then make videos from it right away.",
  "rec": ""
 },
 "shape": {
  "title": "Mosaic shape",
  "text": "The proportions of the mosaic. 'Same as picture' keeps your main picture's own shape; the others crop it (around the face) to fit. It is chosen before the mosaic is built.",
  "rec": "Same as picture"
 },
 "tile_shape": {
  "title": "Tile shape",
  "text": "The shape of each small photo. Square is classic; wide or tall tiles keep more of landscape or portrait photos. Photos are cropped to fit.",
  "rec": "Square"
 },
 "video_shape": {
  "title": "Video shape",
  "text": "The proportions of the video. By default it matches your mosaic. Choose Story for phones, Wide for TVs and YouTube; the mosaic is fitted inside with the backdrop around it.",
  "rec": "Same as mosaic"
 },
 "prep_skip": {
  "title": "Skip all preparation",
  "text": "Use your photos exactly as they are, with no cleaning. Every photo is still cropped to a square. Choose this if you already cleaned your photos, or to save time.",
  "rec": ""
 },
 "prep_trim": {
  "title": "Trim borders and frames",
  "text": "Removes white or black frames and thin borders around photos (screenshots, framed prints, chat-app photos) so they do not show as stripes in the mosaic.",
  "rec": "On"
 },
 "prep_dedupe": {
  "title": "Remove duplicates",
  "text": "Finds near-identical photos (burst shots, the same picture saved twice) and keeps only one, so the same face does not appear next to itself.",
  "rec": "On"
 },
 "prep_filter": {
  "title": "Skip blurry and tiny photos",
  "text": "Leaves out photos that are too blurry or too small. They would only look like smudges at tile size.",
  "rec": "On"
 },
 "prep_crop": {
  "title": "Smart square crop",
  "text": "Tiles are squares. Smart crop keeps the part of each photo with faces and detail instead of cutting a plain square from the middle.",
  "rec": "On"
 },
 "prep_rotate": {
  "title": "Fix sideways photos (experimental)",
  "text": "Tries to turn sideways or upside-down photos upright by looking for faces. It is not always right, so check the review sheet if you switch it on.",
  "rec": "Off for now"
 },
 "min_sharpness": {
  "title": "Blur strictness",
  "text": "How sharp a photo has to be to be kept. Raise it to drop more soft photos; lower it if good photos are being removed.",
  "rec": "Default"
 },
 "min_side": {
  "title": "Smallest photo size",
  "text": "Photos with a shorter side below this many pixels are left out.",
  "rec": "96 px"
 },
 "preset": {
  "title": "Quality preset",
  "text": "One-click starting points. Quick draft is fast to try ideas; Balanced is right for most people; Best quality makes a larger, more detailed mosaic but takes longer.",
  "rec": "Balanced"
 },
 "detail": {
  "title": "Detail",
  "text": "How many tiles the picture is made of. More tiles means finer detail and a bigger, slower build. Fewer tiles looks chunkier and bolder. You need enough different photos to avoid too many repeats.",
  "rec": "1,500 to 3,000"
 },
 "repeats": {
  "title": "Most times one photo can appear",
  "text": "Limits how often the same photo is used. Lower values look more varied but need more photos. Auto picks a sensible limit from your photo count.",
  "rec": "Auto"
 },
 "spread": {
  "title": "Keep repeats apart",
  "text": "Stops copies of the same photo from sitting close together. Higher numbers spread them further apart, but are harder to satisfy with few photos.",
  "rec": "6"
 },
 "colour": {
  "title": "Colour match",
  "text": "Gently tints each tile toward the colour of the picture underneath. More makes the main picture clearer; less keeps the photos' own colours.",
  "rec": "Around 60%"
 },
 "faces": {
  "title": "Focus on faces and subject",
  "text": "Spends extra care getting faces and the main subject right, at the expense of the background. Great for portraits.",
  "rec": "On, around 60%"
 },
 "grayscale": {
  "title": "Black and white",
  "text": "Makes the whole mosaic black and white: the tiles and the main picture. It gives a classic, dramatic look and often reads more clearly from far away.",
  "rec": "Off, unless you want the classic look"
 },
 "gap_color": {
  "title": "Gap colour",
  "text": "The colour of the thin line between tiles when a gap is set. Black looks like grout in a dark mosaic; white looks like a light frame around each tile.",
  "rec": "Black"
 },
 "also_video": {
  "title": "Also make a video",
  "text": "Every mosaic also gives you the finished picture. Switch this on to get an animation of the mosaic assembling itself as well; you will choose its style, length and quality on the next page. Switch it off if you only want the picture: the build is then a little faster. You can always make videos from a saved mosaic later.",
  "rec": "On"
 },
 "print_size": {
  "title": "Output size",
  "text": "Screen is quick and sized for viewing on a display. Print size makes the image big and sharp enough for a poster at the size and DPI you choose, and saves the DPI inside the file so print shops get it right. 300 DPI is standard for printing; 150 is fine for large posters seen from a distance. Exact pixels lets you type the width or height in pixels (or pick Full HD, 4K, 8K...) when you need a specific size for a website, wallpaper or screen. The other side follows your mosaic's shape.",
  "rec": "Screen for sharing, Print for posters"
 },
 "preview": {
  "title": "Preview before building",
  "text": "Builds a small, fast draft so you can check the arrangement and colours before spending time on the final result. The final mosaic has exactly the same arrangement, just sharper.",
  "rec": ""
 },
 "blend": {
  "title": "Main picture showing through",
  "text": "Lays a faint copy of the main picture over the mosaic image. A little helps it read from a distance; too much hides the tiles.",
  "rec": "10 to 15%"
 },
 "size": {
  "title": "Image sharpness",
  "text": "How many pixels each tile gets in the saved image. Bigger is sharper and good for printing, but makes a larger file and takes longer.",
  "rec": "Standard for screens, Large for print"
 },
 "image_format": {
  "title": "Image file type",
  "text": "PNG is lossless and best for printing or editing. JPEG is small and works everywhere. WebP is small and modern. TIFF is lossless and used by print shops and photo editors; the files are large.",
  "rec": "PNG for quality, JPEG to share"
 },
 "image_quality": {
  "title": "JPEG / WebP quality",
  "text": "Higher keeps more fine detail but makes a bigger file. 90 and above is visually lossless.",
  "rec": "90 to 95"
 },
 "subtiles": {
  "title": "Extra fine detail (small tiles)",
  "text": "Splits some tiles into four smaller ones in the busiest areas, such as eyes and hair, for a sharper face. Works best with many photos.",
  "rec": "On if you have 400+ photos"
 },
 "subtile_percent": {
  "title": "How much to split",
  "text": "The share of tiles that get split into smaller ones. Splitting more adds detail but makes the repeat rules harder to meet.",
  "rec": "20 to 25%"
 },
 "even_usage": {
  "title": "Use all photos evenly",
  "text": "Pushes the builder to use every photo about the same number of times instead of favouring a few lucky ones.",
  "rec": "50%"
 },
 "flip": {
  "title": "Allow mirrored photos",
  "text": "Lets a photo be flipped left-to-right to fit better. It gives a closer match, but flipped text will look backwards.",
  "rec": "On"
 },
 "gap": {
  "title": "Gap between tiles",
  "text": "A thin line between tiles, like grout. 0 is seamless.",
  "rec": "0"
 },
 "seed": {
  "title": "Variation number",
  "text": "The mosaic is built with a bit of randomness. The same number always gives the same result; change it to get a different arrangement.",
  "rec": ""
 },
 "video_style": {
  "title": "Animation style",
  "text": "How the tiles arrive and how the camera moves. Each style has its own camera: Swarm orbits and sweeps, Vortex circles the subject, Wave tracks sideways along a sweeping reveal, Zoom pulls straight back from a close-up.",
  "rec": "Try each one with a Draft preview first."
 },
 "length": {
  "title": "Length",
  "text": "How long the video is, in seconds. Longer videos give the animation more room but make bigger files and take longer to render.",
  "rec": "15 to 25 seconds"
 },
 "quality": {
  "title": "Video quality",
  "text": "Draft is a fast, small preview for judging motion and style. Standard is crisp for sharing. High keeps more detail in dark areas but makes the file about twice the size.",
  "rec": "Draft while exploring, then Standard"
 },
 "format": {
  "title": "File type",
  "text": "MP4 works everywhere. WebM is for the web. (H.265 and GIF are not available in the web version yet.)",
  "rec": "MP4"
 },
 "resolution": {
  "title": "Video resolution",
  "text": "How sharp the video is. 720p is small and quick, 1080p (Full HD) suits phones and most screens, 1440p and 4K are crisper but take much longer to render and make big files. Draft preview ignores this.",
  "rec": "1080p"
 },
 "fps": {
  "title": "Smoothness (frames per second)",
  "text": "30 is standard and smooth. 60 is silkier but doubles render time and file size.",
  "rec": "30"
 },
 "showcase": {
  "title": "Showcase photos",
  "text": "How many photos fly large through the foreground so viewers can see them. 0 turns them off.",
  "rec": "12 to 18"
 },
 "dof": {
  "title": "Depth blur",
  "text": "Blurs tiles that are away from the focus, like a real camera. It adds depth and a premium feel.",
  "rec": "About 70%"
 },
 "glow": {
  "title": "Glow and shadow",
  "text": "A soft shadow and glow around the finished mosaic that lifts it off the background.",
  "rec": "About 60%"
 },
 "particles": {
  "title": "Floating dust",
  "text": "Tiny drifting sparkles in the air. They add atmosphere. 0 turns them off.",
  "rec": "100 to 250"
 },
 "backdrop": {
  "title": "Blurred backdrop",
  "text": "A dark, blurred copy of your main picture behind the mosaic instead of a flat colour.",
  "rec": "On"
 },
 "pulses": {
  "title": "Arrival waves",
  "text": "Tiles land in this many bursts, with calm moments in between. 0 is a constant stream.",
  "rec": "3 to 5"
 },
 "output_folder": {
  "title": "Saving",
  "text": "Your mosaic and video are saved to your device's Downloads (or shared with another app on a phone).",
  "rec": ""
 }
};
