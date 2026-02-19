# RMU Combat Zones

![Latest Version](https://img.shields.io/badge/Version-1.4.2-blue)
![Foundry Version](https://img.shields.io/badge/Foundry-v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System](https://img.shields.io/badge/System-RMU-blue)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-combat-zones/rmu-combat-zones.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-combat-zones/latest/rmu-combat-zones.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/rmu-combat-zones)
![Issues](https://img.shields.io/github/issues/Filroden/rmu-combat-zones)

**RMU Combat Zones** is a lightweight visualisation module for the *Rolemaster Unified* (RMU) system. It automatically renders a token's combat zone, its combat facings (Front, Flank, Rear) and weapon reach arcs directly on the canvas, helping GMs and players make tactical decisions at a glance.

![RMU Combat Zones](https://github.com/Filroden/rmu-combat-zones/blob/main/assets/screenshots/RMU_combat_zones.png?raw=true)

## Features

* **Dynamic Combat Zones:** Automatically draws the Front (Green), Flanks (Yellow), and Rear (Red) zones based on the character's facing and size.
* **Weapon Reach Rings:** Visualizes the threat range of all natural weapons, equipped melee weapons and shields. If reach is affected by talents, etc that are automated by the system, then these are included.
* **Metric & Imperial Support:** Works out of the box with standard feet. Automatically detects Metric scenes and applies a configurable conversion factor (default 3.33) to ensure reach rings match the grid correctly.
* **Live Updates:** Zones update instantly when:
  * Tokens rotate or move.
  * Weapons are equipped or unequipped.
  * Items are modified in the character sheet.

## Settings

There are game settings to customise the look of the combat zone and weapon reach rings.

* **Show All Reach Rings:** If enabled, all reach rings are always visible for all tokens.
* **Custom Colors:** Don't like the default Green/Yellow/Red? You can change the color of the Front, Flank, Rear, and Spoke lines and the front-facing arrow independently using a color picker.
* **Opacity Control:** Adjust the transparency of the zone fills. Set it to `0.0` for no fill, or crank it up for high-contrast visibility on dark maps.
* **Metres-to-Feet Multiplier:** For groups using metric grids, you can tweak the conversion math (Default: 1.5m = 5ft) to match your table's house rules.

## How to Use

### Toggling Visibility

The module adds a toggle button to the **Token Controls** layer (the "person" icon on the left sidebar).

1. Select the **Token Controls** layer.
2. Click the **"Toggle Combat Zones"** tool (the circle-dot icon `◉`).
3. This instantly shows or hides combat zones for **all** tokens on the canvas.
4. **Select** or **hover** over any token to see its weapon reach rings. (Note: Your own character's reach is always visible).

## Important note on visibility

* For combat zones to only be seen by players if they are in their visual range, the scene must have token vision enabled (light tab), and the players' tokens must also have their vision enabled (vision tab).

## Installation

1. In Foundry VTT, go to the **Add-on Modules** tab.
2. Click **Install Module**.
3. Search for "RMU Combat Zones" or paste the manifest URL:
   `https://github.com/Filroden/rmu-combat-zones/releases/latest/download/module.json`

## Compatibility

* **Foundry VTT:** Version 13+ is required.
* **System:** Designed for *Rolemaster Unified* (RMU).

## License

This module is licensed under the [MIT License](LICENSE).
