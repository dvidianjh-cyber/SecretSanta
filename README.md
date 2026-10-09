# Secret Santa

A static, mobile-friendly Secret Santa draw. Each participant enters a private five-letter code and sees only their own recipient. The organiser generates the draw locally; the published site needs no backend.

## Try the demo

The committed `draw_data.json` is a **demo draw**. Its sample join codes are listed below. Replace it before using the app for a real exchange.

| Name | Demo code |
| --- | --- |
| Alice | ZRULU |
| Bob | KNEIS |
| Charlie | XCCRM |
| David | BFGFQ |
| Eve | AFSGC |

## Run a real draw

1. Edit `participants.json` with the current names and optional exclusion rules. Each name must be unique. For a fresh template, use `participants.example.json`.
2. Run `node generate_draw.js --file participants.json`. Node.js 18 or later is required.
3. Save the printed join codes privately and send each participant only their own code. The script does not save the codes to a file.
4. Commit and push the new `draw_data.json`. GitHub Pages will publish the new draw.

You can also run `node generate_draw.js --names "Alice,Bob,Charlie"`. To write a different data file, add `--out path/to/file.json`.

`disallowedPairings` blocks both directions: `["Alice", "Bob"]` means neither can draw the other. `disallowedRecipients` blocks one direction: `"Charlie": ["Eve"]` means Charlie cannot draw Eve, but Eve may draw Charlie. Names must match participants (case is ignored). You can remove either section or leave it empty. The original plain JSON array of names still works, but use the object format to set exclusions. Everyone is always prevented from drawing themselves, and every recipient is assigned exactly once. If the rules make a complete draw impossible, the script reports an error before writing the output file.

Each run makes a fresh draw and fresh codes. Replacing the data invalidates all earlier codes.

## Host on GitHub Pages

The repository publishes from branch **main**, folder **/ (root)**. Each push to `main` updates the site at `https://dvidianjh-cyber.github.io/SecretSanta/`. If Pages is ever disabled, restore that source in **Settings → Pages**.

## Privacy limit

Recipient names are encrypted with AES-GCM using keys derived from the five-letter codes with PBKDF2. Code lookup also uses PBKDF2. The repository does not contain plaintext assignments or real codes. A five-letter code has limited entropy, however, and a determined person with the public data can try all possible codes offline. Treat this as surprise protection for a friendly exchange, not strong secrecy. Do not publish the printed real codes.
