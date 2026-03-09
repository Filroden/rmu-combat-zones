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
        // Clear the overlay if selection changes to avoid sticky lines
        RMUZoneRenderer.drawThreatRulerOverlay(null, false);
    }
});

Hooks.on("hoverToken", (token, hovered) => {
    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        if (hovered) deriveDataSafe(token);
        RMUZoneRenderer.update(token);

        // Pass the hovered token to the overlay manager
        RMUZoneRenderer.drawThreatRulerOverlay(token, hovered);
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

// Consolidated abstraction for document lifecycle events
const triggerDataDerivation = (document) => {
    let actor = document.parent;

    // Traverse up the document tree if an ActiveEffect is nested inside an Item
    if (actor && !(actor instanceof Actor)) {
        actor = actor.parent;
    }

    if (!actor || !(actor instanceof Actor)) return;

    if (game.settings.get(MODULE_ID, SETTINGS.TOGGLE)) {
        const tokens = actor.getActiveTokens();
        // Forcing derivation resolves asynchronous race conditions during data preparation
        for (const t of tokens) deriveDataSafe(t, true);
    }
};

// Item Hooks
Hooks.on("updateItem", triggerDataDerivation);
Hooks.on("createItem", triggerDataDerivation);
Hooks.on("deleteItem", triggerDataDerivation);

// Active Effect Hooks (Status Effects)
Hooks.on("createActiveEffect", triggerDataDerivation);
Hooks.on("updateActiveEffect", triggerDataDerivation);
Hooks.on("deleteActiveEffect", triggerDataDerivation);

Hooks.on("refreshToken", (token) => {
    // Standard update for passive rings
    RMUZoneRenderer.update(token);

    // Dynamic real-time update for the Threat Ruler
    if (RMUZoneRenderer.hoveredToken) {
        // Only recalculate if the token moving/elevating is the attacker or the defender
        const isTarget = token === RMUZoneRenderer.hoveredToken;
        const isAttacker = canvas.tokens.controlled.includes(token);

        if (isTarget || isAttacker) {
            RMUZoneRenderer.drawThreatRulerOverlay(
                RMUZoneRenderer.hoveredToken,
                true,
            );
        }
    }
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
