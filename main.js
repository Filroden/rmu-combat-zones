/**
 * main.js
 * Root controller. Initialises settings and binds system hooks to the renderer.
 */

import { MODULE_ID, SETTINGS, registerSettings } from "./src/settings.js";
import { deriveDataSafe, RMUZoneRenderer } from "./src/renderer.js";

// --- Initialisation ---

Hooks.once("init", () => {
    // Pass callbacks to the settings file so it can trigger updates
    const callbacks = {
        redraw: () => {
            canvas.tokens.placeables.forEach((t) => {
                t._rmuDirty = true;
                RMUZoneRenderer.update(t);
            });
        },
        derive: () => {
            canvas.tokens.placeables.forEach((t) => deriveDataSafe(t));
        },
    };

    registerSettings(callbacks);
});

// --- Event Hooks ---

Hooks.on("canvasReady", () => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        canvas.tokens.placeables.forEach((t) => deriveDataSafe(t));
    }
});

Hooks.on("controlToken", (token, controlled) => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        if (controlled) deriveDataSafe(token);
        RMUZoneRenderer.update(token);
    }
});

Hooks.on("hoverToken", (token, hovered) => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        if (hovered) deriveDataSafe(token);
        RMUZoneRenderer.update(token);
    }
});

Hooks.on("updateActor", (actor) => {
    if (!actor) return;
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        const tokens = actor.getActiveTokens();
        for (const t of tokens) deriveDataSafe(t, true);
    }
});

Hooks.on("updateToken", (tokenDoc, changes) => {
    if (changes.rotation !== undefined && tokenDoc.object) {
        tokenDoc.object._rmuDirty = true;
        RMUZoneRenderer.update(tokenDoc.object);
    }
});

// Consolidated abstraction for item lifecycle events
const triggerItemUpdate = (item) => {
    if (!item.parent) return;
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        const tokens = item.parent.getActiveTokens();
        for (const t of tokens) deriveDataSafe(t, true);
    }
};

Hooks.on("updateItem", triggerItemUpdate);
Hooks.on("createItem", triggerItemUpdate);
Hooks.on("deleteItem", triggerItemUpdate);

Hooks.on("refreshToken", (token) => {
    RMUZoneRenderer.update(token);
});

Hooks.on("destroyToken", (token) => {
    RMUZoneRenderer.clear(token);
});

// --- Scene Controls ---

Hooks.on("getSceneControlButtons", (controls) => {
    const tokenLayer = controls.tokens;
    if (!tokenLayer) return;

    const rmuTool = {
        name: "rmu-zones",
        title: "RMU-ZONES.ToggleTitle",
        icon: "fas fa-circle-dot",
        toggle: true,
        active: game.settings.get(MODULE_ID, SETTINGS.TOGGLE),
        onChange: () => {
            const current = game.settings.get(MODULE_ID, SETTINGS.TOGGLE);
            game.settings.set(MODULE_ID, SETTINGS.TOGGLE, !current);
        },
    };

    if (Array.isArray(tokenLayer.tools)) {
        tokenLayer.tools.push(rmuTool);
    } else {
        tokenLayer.tools["rmu-zones"] = rmuTool;
    }
});
