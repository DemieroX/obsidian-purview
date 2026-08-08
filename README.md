# PurView
Preview **PureRef** boards (`.pur`) directly inside Obsidian. (Version 1.10/1.11.1 only!)

<img width="2558" height="1373" alt="image" src="https://github.com/user-attachments/assets/9b8253f7-bdf3-4080-8e4c-9caec450e975" />


This is a simple PureRef file viewer, built on top of [FyorDev's PureRef-format parser](https://github.com/FyorDev/PureRef-format).
The parser logic is recreated within JavaScript in a web-environment to read and navigate (`.pur`) natively inside Obsidian. This plugin was initially developed for personal use but I decided to publish it, in case anyone else is interested in a tool like this.

***This plugin ONLY SUPPORTS PUREREF 1.10/1.11.1 FILES since the original reverse-engineered code by FyorDev was for these versions!***

## Features
- Open `.pur` files inside an Obsidian tab, without opening additional software.
- Optional matching with your Obsidian theme background color.

## Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Open your Obsidian vault in your file explorer.
3. Navigate to `.obsidian/plugins/` (if the `plugins` folder does not exist, create it).
4. Create a new folder inside `plugins` named `purview`.
5. Place the downloaded `main.js`, `manifest.json`, and `styles.css` files into the `purview` folder.
6. Go to **Settings** > **Community plugins** and click the **Reload plugins** button (folder icon).
7. Enable **PurView** in the community plugins list.
