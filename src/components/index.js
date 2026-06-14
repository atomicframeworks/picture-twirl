// src/components/index.js
//
// Reusable UI components for Picture Twirl — plain factory functions that
// return DOM elements, styled by the app's existing CSS classes. Import from
// here: `import { Button, Field, Pill } from '../components/index.js';`
//
// See gallery.html / src/gallery.js for a live showcase of every component.

export { Button, IconButton } from './buttons.js';
export { Field } from './forms.js';
export { Card, Heading, SectionHeader, GameHeader, ActionsTray } from './layout.js';
export { Pill } from './pill.js';
export { ScoreboardCard, SetCard, BoardTile, CategoryCell } from './game.js';
