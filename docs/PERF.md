# Performance (measured 2026-10-25)

Check a phone on the real site with `?fps`: a meter in the bottom-left shows frames per second, frame time and
where the main thread spends each frame (sim, update, draw), as medians and 95th percentiles over 2 s, plus draw
calls, triangles and the pixel ratio. A low fps with small numbers there means the GPU is the limit.

## Measured here (headless Chromium, software GPU, so GPU time is not meaningful)

- **Sim is cheap:** 0.19-0.26 ms per tick at 30 ticks/s with 45 animals (`step()` in node, 60 s of play), so about
  8 ms per second of game. Even 5x slower on a phone CPU that is under 1 ms per frame.
- **Main thread per frame** at phone size (390 x 844, 2x pixels): sim 1.7-3.1, update 1.0-1.2, draw submit
  4.5-7.9 ms. With the CPU slowed 4x (Chrome throttling, roughly a mid phone): update 5-8, draw submit 20-29 ms.
  Draw submission is the main-thread cost to watch.
- **Triangles:** about 0.65 M per frame before the shadow pass. Terrain plane 180 k (no shadow); instanced plants
  cast shadows and are drawn twice: ferns 715 x (154 k), trees 85 x (119 k), another 585-instance plant (98 k).
- **Draw calls:** 80-330 per frame. Herd and prey bodies are built from many separate meshes (about 700 small
  shadow-casting meshes in view at the start).
- **Fill rate, likely the real phone limit (not measurable here):** 2x pixel ratio with antialiasing, 2048
  PCF-soft shadows, and procedural skin shaders (Voronoi scales, 27-cell loops) on the player.

## Levers, cheapest first (not built)

1. Pixel ratio 1.5 on touch devices, and a lower shadow map (1024) there.
2. Stop small plants casting shadows (ferns and the 585-instance plant), halving their triangles.
3. Merge each herd animal's parts into one mesh per animal (draw calls).
4. Skin shader detail off beyond a few metres on phones (the shader already fades it by distance).
