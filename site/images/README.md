# Image resources

Character images use the same combined costume-and-character ID (`memberMstId`) as the models and skills folders.

```text
images/
  <member ID>/
    character-art.png
    skills/
    preview/             # Original sample images, where present
  costumes/
    <costume ID>/
      costume-icon.png
      shared/            # Skill textures shared within this costume
  shared/                # Skill textures shared across costumes
  catalog.json
```

For example, `images/10002103/`, `models/10002103/` and `skills/10002103/` all belong to 園田 海未 in 僕らは今のなかで.

The image catalog's `members` lookup lists names, artwork and every skill texture used by each member, including shared textures. Costume icons and shared images are listed separately. File paths are relative to the website root.
