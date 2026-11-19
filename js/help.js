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
 "style": { "title": "Style", "text": "The overall choreography. It sets how the camera moves and how tiles arrive. Swarm: tiles swoop in from all sides while the camera orbits. Vortex: tiles spiral in as the camera circles. Wave: a sideways tracking shot follows a wave of tiles. Zoom: starts very close, then pulls back to reveal the picture. Everything below fine-tunes the chosen style.", "rec": "Try each one with your photo" },
 "looks": { "title": "Looks", "text": "A Look is a ready-made bundle of settings: the style, how fast and wild the motion is, where tiles come from, the camera and the mood. Tap one to load it, then change anything you like below. Default is the balanced starting point. Surprise me builds a random, good-looking mix every time you tap it. Save my look keeps your current settings under a name, so you can use them again (saved in this browser). The card that is lit up matches your current settings; it goes out as soon as you change something.", "rec": "Start from a Look, then tweak" },
 "camera": { "title": "Camera", "text": "How the camera moves while tiles arrive. By default each Style brings its own camera. Pick a camera move to use it with any Style, then drag the dots on the timeline to shape it. Whatever you design, the camera always finishes on the full picture so the reveal works.", "rec": "Start from a move, then drag the dots" },
 "cam_time": { "title": "When (share of the video)", "text": "When the selected keyframe happens, as a share of the video length. The first keyframe is always at the start.", "rec": "Space them evenly" },
 "cam_zoom": { "title": "Distance", "text": "How far the camera is from the picture at this keyframe. 1x shows the whole picture. Smaller is closer, larger shows more empty space around it.", "rec": "0.4x to 1.5x" },
 "cam_pan": { "title": "Move left / right and up / down", "text": "Slides the camera sideways or vertically at this keyframe, as a share of the picture size.", "rec": "Small moves look best" },
 "cam_yaw": { "title": "Turn around the picture", "text": "Swings the camera around the picture like walking in a circle around it. 0 looks straight on.", "rec": "Within about 60 degrees" },
 "cam_pitch": { "title": "Look from above / below", "text": "Raises the camera above the picture looking down (positive) or lowers it below looking up (negative).", "rec": "0 to 30 degrees" },
 "cam_roll": { "title": "Tilt the horizon", "text": "Banks the camera sideways like a plane turning. A small amount adds energy, a lot feels dizzy.", "rec": "Under 10 degrees" },
 "tile_presets": { "title": "Tile motion presets", "text": "Quick starting points for how the tiles move, without touching the camera or mood. Default is the balanced setting. Gentle is slow and soft, Lively is bouncy and busy, Wild is fast and chaotic. Surprise picks a random mix.", "rec": "Gentle or Default" },
 "entry": { "title": "Tiles fly in from", "text": "Where tiles start before flying into place. As designed uses the style's own choice. All around scatters them in every direction. Top, Bottom and Sides make them slide in from that edge. Centre burst shoots them out of the middle. Front makes them rush toward the camera.", "rec": "As designed" },
 "order": { "title": "Build order", "text": "Which tiles arrive first. As designed follows the camera. Random is a scattered fizz. Centre out builds from the middle, Edges in builds a frame first. Left to right and Top to bottom sweep across the picture. Dark to bright or Bright to dark builds by tile brightness. The showcase photos keep their own timing.", "rec": "Centre out for a bloom" },
 "arc": { "title": "Flight curve", "text": "How curved each tile's path is. 0 flies in a straight line. 100% is the style's own curve. Higher makes big sweeping arcs.", "rec": "100%" },
 "ease": { "title": "Landing feel", "text": "How a tile moves as it lands. Glide: speeds in and settles softly. Smooth: gentle start and end. Bounce: overshoots its spot, then settles back. Snap: rushes in and stops suddenly. Steady: constant speed.", "rec": "Glide" },
 "flash": { "title": "Landing sparkle", "text": "How bright a tile flashes the moment it lands. 0 turns the sparkle off.", "rec": "100%" },
 "hero_hold": { "title": "Showcase hold", "text": "How long each showcase photo lingers on screen in the middle of its flight so viewers can see it. 0 makes it fly straight through.", "rec": "About 80%" },
 "hero_size": { "title": "Showcase photo size", "text": "How big the showcase photos are as they fly past. Larger photos are easier to see but cover more of the mosaic.", "rec": "About 38%" },
 "flight_scale": { "title": "How far tiles fly in from", "text": "How far away tiles start before they fly into place. Higher feels more dramatic and sweeping.", "rec": "About 1.7x" },
 "flight_speed": { "title": "Tile flight time", "text": "How long each tile takes to fly into place. Lower is snappier, higher is slow and floaty.", "rec": "100%" },
 "arrival_spread": { "title": "How long tiles keep arriving", "text": "Lower packs the arrivals into a shorter, busier build-up. Higher spreads them over more of the video.", "rec": "100%" },
 "spin": { "title": "Tile spin and tilt", "text": "How much tiles tumble as they fly. 0 makes them glide in flat.", "rec": "100%" },
 "pulse_depth": { "title": "Arrival wave strength", "text": "How strongly the arrivals come in bursts. 0 is a steady stream. It only matters when Arrival waves is above 0.", "rec": "About 55%" },
 "camera_motion": { "title": "Camera sway", "text": "How much the camera drifts and wobbles while tiles arrive. 0 keeps it steady.", "rec": "100%" },
 "frame_margin": { "title": "Camera framing", "text": "How closely the camera frames the finished mosaic at the end. Higher is closer, lower leaves more space around it.", "rec": "About 0.8" },
 "reveal_time": { "title": "Final picture appears at", "text": "When the finished photo fades in over the tiles, as a share of the video length. Earlier gives it more time on screen.", "rec": "78%" },
 "background": { "title": "Background", "text": "What is behind the mosaic. Pick a mood with the quick presets, or build your own: choose a type (photo glow, one colour, or a two-colour gradient), then the colours. The glow around the finished mosaic and the floating dust follow your photo's colours unless you choose your own.", "rec": "Start from a preset" },
 "bg_presets": { "title": "Background presets", "text": "One tap sets the whole background: type, colours, edge darkening and lights. Default is the standard dark photo glow. Surprise picks a random pleasing colour mix.", "rec": "Default or Midnight" },
 "bg_mode": { "title": "Background type", "text": "Photo glow: a soft blurred copy of your picture fills the background, as in the default look. Solid colour: one flat colour. Gradient: blends smoothly from one colour at the top to another at the bottom.", "rec": "Photo glow" },
 "bg_color": { "title": "Colour", "text": "The main background colour. In Photo glow it fills the darkened edges and tints the backdrop. In Solid colour it is the whole background. In Gradient it is the top colour. It is also the colour distant tiles fade into.", "rec": "A dark colour that suits your photo" },
 "bg_color2": { "title": "Second colour", "text": "The bottom colour of the gradient.", "rec": "A darker or warmer shade of the first colour" },
 "bg_amount": { "title": "Photo strength", "text": "How visible the blurred photo is in Photo glow. 0 hides it, leaving just your colour and lights.", "rec": "100%" },
 "bg_vignette": { "title": "Edge darkening", "text": "How much the edges of the frame darken to focus attention on the middle. 0 is flat.", "rec": "About 60%" },
 "bg_lights": { "title": "Colour lights", "text": "Soft coloured lights that slowly drift across the background. 0 turns them off, which suits light backgrounds.", "rec": "100% on dark, 0% on white" },
 "accent_mode": { "title": "Glow and dust colour", "text": "Match photo picks the glow around the finished mosaic, the floating dust and the background lights from your photo's colours. My colour lets you choose them yourself.", "rec": "Match photo" },
 "accent_color": { "title": "My glow colour", "text": "The colour of the glow, dust and drifting lights when 'My colour' is selected.", "rec": "A bright colour that suits the background" },
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
