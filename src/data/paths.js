// src/data/paths.js
export const game = (id) => `games/${id}`;
export const title = (id) => `games/${id}/title`;
export const gmName = (id) => `games/${id}/gmName`;
export const participants = (id) => `games/${id}/participants`;
export const participant = (id, uid) => `games/${id}/participants/${uid}`;
export const teams = (id) => `games/${id}/teams`;
export const scores = (id) => `games/${id}/scores`;
export const score = (id, k) => `games/${id}/scores/${k}`;
export const state = (id) => `games/${id}/state`;
export const phase = (id) => `games/${id}/state/phase`;
export const board = (id) => `games/${id}/board`;
export const boardTile = (id, tileId) => `games/${id}/board/${tileId}`;
export const currentQuestion = (id) => `games/${id}/currentQuestion`;
export const buzzQueue = (id) => `games/${id}/buzzQueue`;
export const settings = (id) => `games/${id}/settings`;
export const setId = (id) => `games/${id}/settings/setId`;
export const index = (id) => `gameIndex/${id}`;
