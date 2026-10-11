// tools/content/lib/xlsx.mjs
//
// A small, dependency-free .xlsx reader: enough for the Content Tracker (a
// Google Sheets export) — cell values, shared strings, and hyperlinks (both
// HYPERLINK() formulas and real cell links). An .xlsx is a ZIP of XML files;
// we read the ZIP's central directory and inflate entries with node:zlib.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** filename → Buffer for every entry in a ZIP. */
function unzip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP/xlsx file (no end-of-central-directory record).');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const files = new Map();
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const data = buf.subarray(start, start + compSize);
        if (method === 0) files.set(name, Buffer.from(data));
        else if (method === 8) files.set(name, inflateRawSync(data));
        p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const decode = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** All <t> texts inside a fragment, joined (rich-text runs). */
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function relsOf(files, path) {
    const xml = files.get(path)?.toString('utf8') || '';
    return new Map([...xml.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), decode(attr(m[0], 'Target') || '')]));
}

/**
 * @param {string} file  path to the .xlsx
 * @returns {{ sheets: Array<{ name: string, rows: Array<Record<string, string>>, links: Record<string, string> }> }}
 *   rows: one object per non-empty row, keyed by column letter ("A", "B", …); row 0 is usually the header.
 *   links: cell ref ("E2") → URL.
 */
export function readXlsx(file) {
    const files = unzip(readFileSync(file));
    const shared = [];
    const ss = files.get('xl/sharedStrings.xml')?.toString('utf8') || '';
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));

    const workbook = files.get('xl/workbook.xml')?.toString('utf8') || '';
    const wbRels = relsOf(files, 'xl/_rels/workbook.xml.rels');
    const sheets = [];
    for (const m of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
        const name = decode(attr(m[0], 'name') || '');
        const target = wbRels.get(attr(m[0], 'r:id'));
        if (!target) continue;
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        const xml = files.get(path)?.toString('utf8') || '';
        const rels = relsOf(files, path.replace('worksheets/', 'worksheets/_rels/') + '.rels');

        const links = {};
        for (const h of xml.matchAll(/<hyperlink\b[^>]*\/>/g)) {
            const ref = attr(h[0], 'ref');
            const url = rels.get(attr(h[0], 'r:id')) || attr(h[0], 'location');
            if (ref && url) links[ref] = url;
        }

        const rows = [];
        for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
            const cells = {};
            for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const ref = attr(c[1], 'r');
                const type = attr(c[1], 't');
                const inner = c[2] || '';
                const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
                let value = '';
                if (type === 's' && v != null) value = shared[Number(v)] ?? '';
                else if (type === 'inlineStr') value = texts(inner);
                else if (v != null) value = decode(v);
                const formula = inner.match(/<f>([\s\S]*?)<\/f>/)?.[1];
                const link = formula && decode(formula).match(/HYPERLINK\(\s*"([^"]+)"/i)?.[1];
                if (link && ref && !links[ref]) links[ref] = link;
                if (ref && value !== '') cells[ref.replace(/\d+$/, '')] = value;
                if (ref && link && value === '') cells[ref.replace(/\d+$/, '')] = link;
            }
            const rowNum = Number(attr(r[0], 'r'));
            if (Object.keys(cells).length) rows.push({ _row: rowNum, ...cells });
        }
        sheets.push({ name, rows, links });
    }
    return { sheets };
}
