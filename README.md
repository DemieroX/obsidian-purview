# PurView - PureRef Viewer for Obsidian
Preview **PureRef** boards (`.pur`) directly inside Obsidian. Supports **PureRef 1.10/1.11.1** and **PureRef 2.x** (including 2.1.2).

<img width="2558" height="1373" alt="image" src="https://github.com/user-attachments/assets/9b8253f7-bdf3-4080-8e4c-9caec450e975" />


PureRef 1.x parsing is based on [FyorDev's PureRef-format work](https://github.com/FyorDev/PureRef-format). PureRef 2.x boards are rendered by exporting the scene via the PureRef CLI — **PureRef must be installed** on your computer.

## Features
- Open `.pur` files inside an Obsidian tab.
- PureRef 1.x boards with pan and zoom.
- PureRef 2.x boards via PureRef CLI export (requires PureRef installed).
- Optional matching with your Obsidian theme background color.

## Requirements
- **PureRef 2.x boards:** [PureRef](https://www.pureref.com) must be installed (desktop only).
- **PureRef 1.x boards:** no extra software required.

## Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Open your Obsidian vault in your file explorer.
3. Navigate to `.obsidian/plugins/` (if the `plugins` folder does not exist, create it).
4. Create a new folder inside `plugins` named `purview`.
5. Place the downloaded plugin files into the `purview` folder.
6. Go to **Settings** > **Community plugins** and click the **Reload plugins** button (folder icon).
7. Enable **PurView** in the community plugins list.
