# Mirage screenshots — capture pipeline

No images ship in this repo yet, by design. The reference sites' screenshots
are copyrighted; **facts are free, assets are not** (spec §6.1). Every lineup
needs your own captures.

## One pass per lineup (builds V1 images + V2 data together)

1. Start a practice server:
   `sv_cheats 1; mp_warmup_end; sv_infinite_ammo 1; sv_grenade_trajectory_prediction 1`
2. Enable `cl_showpos 1`.
3. Recreate the lineup from its `stand`/`aim` text. **If it no longer lands,
   fix or drop it** — a wrong lineup is worse than no lineup.
4. Screenshot the stand position → `img/mirage/<lineup-folder>/stand.jpg`
5. Screenshot the crosshair placement → `img/mirage/<lineup-folder>/aim.jpg`
6. Copy the `cl_showpos` X/Y/Z into the lineup's `spot` field in
   `lineups/de_mirage.json` (used by V2 proximity matching; ignored by V1).
7. Flip the lineup's `verified` flag to `true`. The overlay drops the
   UNVERIFIED badge automatically.

Folder names match the lineup ids (minus the `mirage-t-smoke-` prefix):

```
img/mirage/
  stairs-tspawn/    stairs-ramp/      ticket-tspawn/
  jungle-ramp/      jungle-windows/   window-trashcan/
  window-scaffold/  topmid-trashcan/
```

Keep captures ~1280px wide JPGs; the overlay column is 380px, so anything
bigger only costs load time.
